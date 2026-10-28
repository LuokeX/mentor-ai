export class SandboxError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string)
}

export function assertWorkspaceId(id: string): string
export function safeFileName(name: string): string

export interface WorkspaceManagerOptions {
  root: string
  maxFileBytes: number
  maxWorkspaceBytes: number
  maxFiles: number
  ttlMs: number
}

export interface SandboxFileInfo {
  name: string
  size: number
  updatedAt: number
}

export class WorkspaceManager {
  constructor(options: WorkspaceManagerOptions)
  init(): Promise<void>
  count(): number
  create(): Promise<string>
  ensure(id: string): Promise<string>
  listFiles(id: string): Promise<SandboxFileInfo[]>
  putFile(id: string, name: string, buffer: Buffer): Promise<{ name: string; size: number }>
  readFile(id: string, name: string): Promise<Buffer>
  deleteFile(id: string, name: string): Promise<{ name: string }>
  deleteWorkspace(id: string): Promise<{ id: string }>
  cleanupExpired(now?: number): Promise<void>
}
