/**
 * 文档工作区沙箱 runner。
 *
 * 独立容器、非 root、只读根文件系统、tmpfs 工作区、无外网；只提供固定的
 * 工作区/文件/文本抽取接口，不执行 shell、不运行上传文件、不访问模型。
 * app 通过内部网络 + Bearer token 调用；token 为空时拒绝启动。
 */
import { createServer } from 'node:http'
import { createHash, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { SandboxError, WorkspaceManager } from './workspaces.mjs'
import { extractText } from './extract.mjs'

const JSON_BODY_LIMIT = 64 * 1024

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store'
  })
  res.end(body)
}

function sendBuffer(res, buffer, contentType) {
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': buffer.length,
    'cache-control': 'no-store'
  })
  res.end(buffer)
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      throw new SandboxError(413, 'BODY_TOO_LARGE', '请求体超过大小限制')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function authorized(req, token) {
  if (!token) return false
  const header = req.headers.authorization || ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  const actual = createHash('sha256').update(provided).digest()
  const expected = createHash('sha256').update(token).digest()
  return timingSafeEqual(actual, expected)
}

function contentTypeFor(name) {
  const extension = String(name).toLowerCase().split('.').pop() || ''
  if (extension === 'txt' || extension === 'md' || extension === 'markdown') return 'text/plain; charset=utf-8'
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/octet-stream'
}

function decodeFileName(segment) {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new SandboxError(400, 'INVALID_FILE_NAME', '文件名不合法')
  }
}

function parseJsonBody(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8') || '{}')
  } catch {
    throw new SandboxError(400, 'INVALID_JSON', '请求体不是合法 JSON')
  }
}

/**
 * 创建未监听的 runner。测试可 listen(0)；生产入口见 start()。
 * @param {{ token: string, root: string, maxFileBytes: number, maxWorkspaceBytes: number, maxFiles: number, ttlMs: number, logger?: (line: object) => void }} options
 */
export async function createRunner(options) {
  const manager = new WorkspaceManager({
    root: options.root,
    maxFileBytes: options.maxFileBytes,
    maxWorkspaceBytes: options.maxWorkspaceBytes,
    maxFiles: options.maxFiles,
    ttlMs: options.ttlMs
  })
  await manager.init()
  const logger = options.logger || (line => console.log(JSON.stringify(line)))

  const server = createServer(async (req, res) => {
    const startedAt = Date.now()
    let status = 200
    try {
      const url = new URL(req.url || '/', 'http://sandbox')
      const parts = url.pathname.split('/').filter(Boolean)

      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { status: 'ok', workspaces: manager.count() })
      }
      if (!authorized(req, options.token)) {
        status = 401
        return sendJson(res, 401, { error: { code: 'UNAUTHORIZED', message: '未授权' } })
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'v1' && parts[1] === 'workspaces') {
        const workspaceId = await manager.create()
        status = 201
        return sendJson(res, 201, { workspaceId })
      }

      if (req.method === 'DELETE' && parts.length === 3 && parts[0] === 'v1' && parts[1] === 'workspaces') {
        const result = await manager.deleteWorkspace(parts[2])
        return sendJson(res, 200, result)
      }

      if (parts[0] === 'v1' && parts[1] === 'workspaces' && parts.length >= 4) {
        const workspaceId = parts[2]
        if (parts[3] === 'files' && parts.length === 4 && req.method === 'GET') {
          return sendJson(res, 200, { files: await manager.listFiles(workspaceId) })
        }
        if (parts[3] === 'extract' && parts.length === 4 && req.method === 'POST') {
          const body = parseJsonBody(await readBody(req, JSON_BODY_LIMIT))
          if (!body || typeof body.name !== 'string') {
            throw new SandboxError(400, 'INVALID_FILE_NAME', '缺少文件名称')
          }
          const buffer = await manager.readFile(workspaceId, body.name)
          return sendJson(res, 200, extractText(body.name, buffer))
        }
        if (parts[3] === 'files' && parts.length === 5) {
          const name = decodeFileName(parts[4])
          if (req.method === 'PUT') {
            const buffer = await readBody(req, options.maxFileBytes + 1)
            const result = await manager.putFile(workspaceId, name, buffer)
            status = 201
            return sendJson(res, 201, result)
          }
          if (req.method === 'GET') {
            const buffer = await manager.readFile(workspaceId, name)
            return sendBuffer(res, buffer, contentTypeFor(name))
          }
          if (req.method === 'DELETE') {
            return sendJson(res, 200, await manager.deleteFile(workspaceId, name))
          }
        }
      }

      status = 404
      return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
    } catch (error) {
      if (res.headersSent) {
        res.destroy()
        return
      }
      const sandboxError = error instanceof SandboxError ? error : null
      status = sandboxError?.status || 500
      if (!sandboxError) {
        console.error('[sandbox] 内部错误:', error instanceof Error ? error.message : error)
      }
      return sendJson(res, status, {
        error: {
          code: sandboxError?.code || 'INTERNAL',
          message: sandboxError?.message || '沙箱服务内部错误'
        }
      })
    } finally {
      logger({ event: 'sandbox_request', method: req.method, status, durationMs: Date.now() - startedAt })
    }
  })

  const cleanupTimer = setInterval(() => {
    manager.cleanupExpired().catch(error => {
      console.error('[sandbox] 清理过期工作区失败:', error instanceof Error ? error.message : error)
    })
  }, 60_000)
  cleanupTimer.unref()
  server.on('close', () => clearInterval(cleanupTimer))

  return { server, manager }
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

async function start() {
  const token = process.env.SANDBOX_RUNNER_TOKEN || ''
  if (!token) {
    console.error('[sandbox] SANDBOX_RUNNER_TOKEN 未配置，拒绝启动')
    process.exit(1)
  }
  const port = numberFromEnv('SANDBOX_PORT', 3200)
  const { server } = await createRunner({
    token,
    root: process.env.SANDBOX_WORKSPACE_ROOT || '/workspaces',
    maxFileBytes: numberFromEnv('SANDBOX_MAX_FILE_BYTES', 20 * 1024 * 1024),
    maxWorkspaceBytes: numberFromEnv('SANDBOX_MAX_WORKSPACE_BYTES', 100 * 1024 * 1024),
    maxFiles: numberFromEnv('SANDBOX_MAX_FILES', 50),
    ttlMs: numberFromEnv('SANDBOX_WORKSPACE_TTL_MS', 30 * 60 * 1000)
  })
  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ event: 'sandbox_started', port }))
  })
  const shutdown = () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5000).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  start().catch(error => {
    console.error('[sandbox] 启动失败:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
