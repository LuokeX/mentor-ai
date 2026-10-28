/**
 * 文档工作区管理：每个任务一个临时目录，只允许普通文件，限制数量/大小/存活时间。
 * 不解析路径中的目录层级，文件名一律当作 basename；越界、符号链接和临时文件都拒绝。
 */
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile, rename } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEMP_PREFIX = '.upload-'

export class SandboxError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'SandboxError'
    this.status = status
    this.code = code
  }
}

export function assertWorkspaceId(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new SandboxError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在')
  }
  return id
}

/** 文件名只保留 basename，拒绝目录分隔符、控制字符与 . / ..。 */
export function safeFileName(name) {
  if (typeof name !== 'string') throw new SandboxError(400, 'INVALID_FILE_NAME', '文件名不合法')
  const trimmed = name.normalize('NFC').trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\') || /[\u0000-\u001f]/.test(trimmed)) {
    throw new SandboxError(400, 'INVALID_FILE_NAME', '文件名不合法')
  }
  if (trimmed.length > 120) throw new SandboxError(400, 'INVALID_FILE_NAME', '文件名过长')
  if (trimmed.startsWith(TEMP_PREFIX)) throw new SandboxError(400, 'INVALID_FILE_NAME', '文件名不合法')
  return trimmed
}

export class WorkspaceManager {
  constructor(options) {
    this.root = resolve(options.root)
    this.maxFileBytes = options.maxFileBytes
    this.maxWorkspaceBytes = options.maxWorkspaceBytes
    this.maxFiles = options.maxFiles
    this.ttlMs = options.ttlMs
    this.workspaces = new Map()
    this.locks = new Map()
  }

  async init() {
    await mkdir(this.root, { recursive: true })
    const entries = await readdir(this.root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID_RE.test(entry.name)) continue
      const info = await stat(join(this.root, entry.name)).catch(() => null)
      if (!info) continue
      this.workspaces.set(entry.name, { createdAt: info.mtimeMs })
    }
    await this.cleanupExpired()
  }

  count() {
    return this.workspaces.size
  }

  dirOf(id) {
    const safeId = assertWorkspaceId(id)
    const dir = resolve(join(this.root, safeId))
    if (!dir.startsWith(this.root + sep)) throw new SandboxError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在')
    return dir
  }

  async create() {
    const id = randomUUID()
    await mkdir(this.dirOf(id), { recursive: false })
    this.workspaces.set(id, { createdAt: Date.now() })
    return id
  }

  async ensure(id) {
    const safeId = assertWorkspaceId(id)
    if (!this.workspaces.has(safeId)) {
      const info = await stat(this.dirOf(safeId)).catch(() => null)
      if (!info?.isDirectory()) throw new SandboxError(404, 'WORKSPACE_NOT_FOUND', '工作区不存在')
      this.workspaces.set(safeId, { createdAt: info.mtimeMs })
    }
    return safeId
  }

  /** 同一工作区的写入串行化，避免并发上传时大小/数量校验竞态。 */
  async withLock(id, fn) {
    const previous = this.locks.get(id) || Promise.resolve()
    const current = previous.catch(() => undefined).then(fn)
    this.locks.set(id, current)
    try {
      return await current
    } finally {
      if (this.locks.get(id) === current) this.locks.delete(id)
    }
  }

  async listFiles(id) {
    const safeId = await this.ensure(id)
    const dir = this.dirOf(safeId)
    const entries = await readdir(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(TEMP_PREFIX)) continue
      const info = await stat(join(dir, entry.name)).catch(() => null)
      if (!info) continue
      files.push({ name: entry.name, size: info.size, updatedAt: info.mtimeMs })
    }
    files.sort((a, b) => a.name.localeCompare(b.name))
    return files
  }

  async putFile(id, name, buffer) {
    const safeId = await this.ensure(id)
    const fileName = safeFileName(name)
    if (buffer.length > this.maxFileBytes) {
      throw new SandboxError(413, 'FILE_TOO_LARGE', '单个文件超过大小限制')
    }
    return this.withLock(safeId, async () => {
      const files = await this.listFiles(safeId)
      const existing = files.find(file => file.name === fileName)
      const total = files.reduce((sum, file) => sum + file.size, 0) - (existing?.size || 0)
      if (!existing && files.length >= this.maxFiles) {
        throw new SandboxError(409, 'TOO_MANY_FILES', '工作区文件数量已达上限')
      }
      if (total + buffer.length > this.maxWorkspaceBytes) {
        throw new SandboxError(413, 'WORKSPACE_TOO_LARGE', '工作区总大小超过限制')
      }
      const dir = this.dirOf(safeId)
      const temp = join(dir, `${TEMP_PREFIX}${randomUUID()}`)
      const target = join(dir, fileName)
      try {
        await writeFile(temp, buffer, { mode: 0o600, flag: 'wx' })
        await rename(temp, target)
      } catch (error) {
        await unlink(temp).catch(() => undefined)
        throw error
      }
      return { name: fileName, size: buffer.length }
    })
  }

  async readFile(id, name) {
    const safeId = await this.ensure(id)
    const fileName = safeFileName(name)
    const target = join(this.dirOf(safeId), fileName)
    const info = await stat(target).catch(() => null)
    if (!info?.isFile()) throw new SandboxError(404, 'FILE_NOT_FOUND', '文件不存在')
    if (info.size > this.maxFileBytes) throw new SandboxError(413, 'FILE_TOO_LARGE', '文件超过大小限制')
    return readFile(target)
  }

  async deleteFile(id, name) {
    const safeId = await this.ensure(id)
    const fileName = safeFileName(name)
    return this.withLock(safeId, async () => {
      const target = join(this.dirOf(safeId), fileName)
      try {
        await unlink(target)
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          throw new SandboxError(404, 'FILE_NOT_FOUND', '文件不存在')
        }
        throw error
      }
      return { name: fileName }
    })
  }

  async deleteWorkspace(id) {
    const safeId = assertWorkspaceId(id)
    return this.withLock(safeId, async () => {
      await rm(this.dirOf(safeId), { recursive: true, force: true })
      this.workspaces.delete(safeId)
      return { id: safeId }
    })
  }

  async cleanupExpired(now = Date.now()) {
    const ids = [...this.workspaces.keys()]
    for (const id of ids) {
      const info = this.workspaces.get(id)
      if (!info) continue
      if (now - info.createdAt <= this.ttlMs) continue
      await this.deleteWorkspace(id).catch(() => undefined)
    }
  }
}
