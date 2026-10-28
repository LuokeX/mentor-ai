/**
 * 文档工作区沙箱客户端（Phase 1）。
 *
 * 只通过内部网络调用独立 runner；token 来自运行时配置，不写入日志。
 * 当前只提供工作区/文件/文本抽取的底层能力，Agent 工具与上传 UI 在 Phase 2 接入。
 */
import type { H3Event } from 'h3'

export interface SandboxFile {
  name: string
  size: number
  updatedAt: number
}

/** 领域层错误：由后续工具/路由映射为 createError，避免领域模块依赖 Nitro 自动导入。 */
export class SandboxClientError extends Error {
  readonly statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'SandboxClientError'
    this.statusCode = statusCode
  }
}

export interface SandboxExtractResult {
  text: string
  truncated: boolean
}

export class SandboxClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private endpoint(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}${path}`
  }

  private async request(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
    let response: Response
    try {
      response = await fetch(this.endpoint(path), {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(init.headers || {})
        }
      })
    } catch {
      throw new SandboxClientError(503, '沙箱服务暂时不可用，请稍后重试')
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null
      const message = payload?.error?.message || '沙箱服务暂时不可用，请稍后重试'
      throw new SandboxClientError(
        response.status === 413 || response.status === 415 ? response.status : 502,
        message
      )
    }
    return response
  }

  async createWorkspace(): Promise<string> {
    const response = await this.request('/v1/workspaces', { method: 'POST' })
    const payload = await response.json() as { workspaceId?: unknown }
    if (typeof payload.workspaceId !== 'string') {
      throw new SandboxClientError(502, '沙箱工作区创建失败')
    }
    return payload.workspaceId
  }

  async putFile(workspaceId: string, name: string, data: Buffer, timeoutMs = 30_000): Promise<SandboxFile> {
    const response = await this.request(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(name)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(data)
      },
      timeoutMs
    )
    const payload = await response.json() as { name?: unknown; size?: unknown }
    return {
      name: typeof payload.name === 'string' ? payload.name : name,
      size: typeof payload.size === 'number' ? payload.size : data.length,
      updatedAt: Date.now()
    }
  }

  async listFiles(workspaceId: string): Promise<SandboxFile[]> {
    const response = await this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/files`)
    const payload = await response.json() as { files?: unknown }
    return Array.isArray(payload.files) ? payload.files as SandboxFile[] : []
  }

  async getFile(workspaceId: string, name: string): Promise<Buffer> {
    const response = await this.request(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(name)}`
    )
    return Buffer.from(await response.arrayBuffer())
  }

  async extractText(workspaceId: string, name: string): Promise<SandboxExtractResult> {
    const response = await this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    })
    const payload = await response.json() as { text?: unknown; truncated?: unknown }
    if (typeof payload.text !== 'string') {
      throw new SandboxClientError(502, '资料解析失败')
    }
    return { text: payload.text, truncated: payload.truncated === true }
  }

  async deleteFile(workspaceId: string, name: string): Promise<void> {
    await this.request(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    )
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}`, { method: 'DELETE' })
  }
}

/**
 * 按运行时配置创建客户端；未启用沙箱返回 null，启用但配置缺失直接报错（不静默降级）。
 */
export function sandboxClient(event: H3Event): SandboxClient | null {
  const config = useRuntimeConfig(event)
  if (!config.sandboxEnabled) return null
  const url = String(config.sandboxRunnerUrl || '').trim()
  const token = String(config.sandboxRunnerToken || '').trim()
  if (!url || !token) {
    throw new SandboxClientError(503, '沙箱服务未配置，请联系管理员')
  }
  return new SandboxClient(url, token)
}
