import type { Server } from 'node:http'
import type { WorkspaceManager } from './workspaces.mjs'

export interface RunnerOptions {
  token: string
  root: string
  maxFileBytes: number
  maxWorkspaceBytes: number
  maxFiles: number
  ttlMs: number
  logger?: (line: Record<string, unknown>) => void
}

export function createRunner(options: RunnerOptions): Promise<{ server: Server; manager: WorkspaceManager }>
