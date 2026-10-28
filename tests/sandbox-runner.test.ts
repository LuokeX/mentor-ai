import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SandboxError, WorkspaceManager, safeFileName } from '../sandbox/workspaces.mjs'
import { extractText } from '../sandbox/extract.mjs'
import { createRunner } from '../sandbox/runner.mjs'
import { SandboxClient } from '../server/domain/sandbox-client'
import { buildLessonPlanDocx } from '../server/domain/lesson-plan-docx'

const tempRoots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mentor-sandbox-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('文档工作区', () => {
  it('创建、写入、读取、列出与清理', async () => {
    const root = await makeRoot()
    const manager = new WorkspaceManager({
      root,
      maxFileBytes: 10,
      maxWorkspaceBytes: 20,
      maxFiles: 2,
      ttlMs: 60_000
    })
    await manager.init()
    const id = await manager.create()
    await manager.putFile(id, 'a.md', Buffer.from('# hi'))
    expect(await manager.listFiles(id)).toHaveLength(1)
    expect((await manager.readFile(id, 'a.md')).toString('utf8')).toBe('# hi')
    await manager.deleteFile(id, 'a.md')
    expect(await manager.listFiles(id)).toHaveLength(0)
    await manager.deleteWorkspace(id)
    expect(manager.count()).toBe(0)
  })

  it('拒绝路径穿越、超大文件、超数量与过期工作区', async () => {
    const root = await makeRoot()
    const manager = new WorkspaceManager({
      root,
      maxFileBytes: 10,
      maxWorkspaceBytes: 20,
      maxFiles: 2,
      ttlMs: 1
    })
    await manager.init()
    const id = await manager.create()
    await expect(manager.putFile(id, '../evil', Buffer.from('x'))).rejects.toBeInstanceOf(SandboxError)
    await expect(manager.putFile(id, 'big.md', Buffer.alloc(11))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    await manager.putFile(id, 'a.md', Buffer.from('a'))
    await manager.putFile(id, 'b.md', Buffer.from('b'))
    await expect(manager.putFile(id, 'c.md', Buffer.from('c'))).rejects.toMatchObject({ code: 'TOO_MANY_FILES' })
    await manager.cleanupExpired(Date.now() + 1000)
    expect(manager.count()).toBe(0)
    expect(() => safeFileName('a/b')).toThrow(SandboxError)
    expect(() => safeFileName('.upload-x')).toThrow(SandboxError)
  })
})

describe('资料文本抽取', () => {
  it('txt / md 原样读取，docx 抽取正文', () => {
    expect(extractText('a.txt', Buffer.from('班级人数 40')).text).toBe('班级人数 40')
    expect(extractText('a.md', Buffer.from('# 标题\n\n正文')).text).toContain('正文')
    const docx = buildLessonPlanDocx({
      title: '五年级班会',
      markdown: '# 五年级班会\n\n## 一、目标\n\n- 第一条约定',
      exportedAt: new Date('2026-10-28T00:00:00Z')
    })
    const result = extractText('plan.docx', docx)
    expect(result.text).toContain('五年级班会')
    expect(result.text).toContain('第一条约定')
    expect(result.truncated).toBe(false)
  })

  it('不支持的类型返回可读错误', () => {
    expect(() => extractText('a.pdf', Buffer.from('x'))).toThrow(SandboxError)
    try {
      extractText('a.pdf', Buffer.from('x'))
    } catch (error) {
      expect((error as SandboxError).code).toBe('UNSUPPORTED_FILE_TYPE')
    }
  })
})

describe('runner HTTP 接口', () => {
  it('鉴权、工作区/文件/抽取接口与客户端可用', async () => {
    const root = await makeRoot()
    const token = 'test-token'
    const { server } = await createRunner({
      token,
      root,
      maxFileBytes: 1024,
      maxWorkspaceBytes: 2048,
      maxFiles: 5,
      ttlMs: 60_000,
      logger: () => undefined
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    const port = address && typeof address === 'object' ? address.port : 0
    const base = `http://127.0.0.1:${port}`
    const auth = { authorization: `Bearer ${token}` }
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200)
      expect((await fetch(`${base}/v1/workspaces`, { method: 'POST' })).status).toBe(401)

      const created = await fetch(`${base}/v1/workspaces`, { method: 'POST', headers: auth })
      expect(created.status).toBe(201)
      const { workspaceId } = await created.json() as { workspaceId: string }

      const put = await fetch(`${base}/v1/workspaces/${workspaceId}/files/${encodeURIComponent('资料.md')}`, {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/octet-stream' },
        body: Buffer.from('# 备课资料\n\n班级人数 40')
      })
      expect(put.status).toBe(201)

      const list = await fetch(`${base}/v1/workspaces/${workspaceId}/files`, { headers: auth })
      const listed = await list.json() as { files: Array<{ name: string }> }
      expect(listed.files[0]?.name).toBe('资料.md')

      const extractedResponse = await fetch(`${base}/v1/workspaces/${workspaceId}/extract`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ name: '资料.md' })
      })
      const extracted = await extractedResponse.json() as { text: string }
      expect(extracted.text).toContain('班级人数')

      const file = await fetch(`${base}/v1/workspaces/${workspaceId}/files/${encodeURIComponent('资料.md')}`, { headers: auth })
      expect(await file.text()).toContain('备课资料')

      const client = new SandboxClient(base, token)
      const clientWorkspace = await client.createWorkspace()
      await client.putFile(clientWorkspace, 'client.txt', Buffer.from('client'))
      expect((await client.extractText(clientWorkspace, 'client.txt')).text).toBe('client')
      expect((await client.listFiles(clientWorkspace)).some(item => item.name === 'client.txt')).toBe(true)
      expect((await client.getFile(clientWorkspace, 'client.txt')).toString('utf8')).toBe('client')
      await client.deleteWorkspace(clientWorkspace)

      expect((await fetch(`${base}/v1/workspaces/${workspaceId}`, { method: 'DELETE', headers: auth })).status).toBe(200)
    } finally {
      await new Promise<void>(resolve => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    }
  })
})
