/**
 * 备课资料工作区工具（Phase 2）。
 *
 * 只在 lesson_prep + 会话绑定了有效工作区时暴露；只能读写 runner 的临时工作区，
 * 不能访问业务库、不能执行 shell、不能访问外网。文件内容不写日志与产品事件。
 */
import { z } from 'zod'
import type { AgentTool, AgentToolContext } from '../types'
import { sandboxClient } from '../../domain/sandbox-client'
import { trackProductEvent } from '../../domain/product-events'
import { redactOutboundText } from '../../domain/ai-governance'

const nameSchema = z.string().trim().min(1).max(120)
const MAX_READ_CHARS = 12_000
const WRITABLE_EXTENSIONS = ['md', 'markdown', 'txt']

function requireWorkspace(ctx: AgentToolContext): { client: NonNullable<ReturnType<typeof sandboxClient>>, workspaceId: string } {
  const workspaceId = ctx.user.sandboxWorkspaceId
  if (!workspaceId) throw new Error('当前对话没有可用的备课资料工作区')
  const client = sandboxClient(ctx.event)
  if (!client) throw new Error('资料工作区暂未开放')
  return { client, workspaceId }
}

function safeFileName(name: string): string {
  const trimmed = name.normalize('NFC').trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || trimmed.includes('/') || trimmed.includes('\\') || /[\u0000-\u001f]/.test(trimmed) || trimmed.length > 120) {
    throw new Error('文件名不合法')
  }
  return trimmed
}

function extensionOf(name: string): string {
  return name.toLowerCase().split('.').pop() || ''
}

export const workspaceListFilesTool: AgentTool = {
  name: 'workspace_list_files',
  description: '列出教师本次备课上传到工作区的资料文件（名称、大小）。教师提到“我上传的资料/附件”时先调用它，再按需读取。',
  schema: z.object({}),
  timeoutMs: 20_000,
  async execute(_args, ctx) {
    const { client, workspaceId } = requireWorkspace(ctx)
    const files = await client.listFiles(workspaceId)
    return { files: files.map(file => ({ name: file.name, size: file.size })) }
  }
}

export const workspaceReadFileTool: AgentTool = {
  name: 'workspace_read_file',
  description: '读取工作区中一个资料的文本内容（支持 txt/md/docx）。一次只读一个文件；内容过长会被截断，可先读相关部分。',
  schema: z.object({ name: nameSchema }),
  timeoutMs: 20_000,
  async execute(args, ctx) {
    const name = safeFileName((args as { name: string }).name)
    const { client, workspaceId } = requireWorkspace(ctx)
    const result = await client.extractText(workspaceId, name)
    const text = result.text.slice(0, MAX_READ_CHARS)
    return {
      name,
      // 资料正文可能含姓名/电话；按学校数据模式脱敏后再送给模型（local 模式不会走到这里）。
      text: redactOutboundText(text, ctx.user.dataMode || 'redacted'),
      truncated: result.truncated || result.text.length > MAX_READ_CHARS
    }
  }
}

export const workspaceWriteFileTool: AgentTool = {
  name: 'workspace_write_file',
  description: '把教学设计、教案草稿或整理后的资料写入工作区（只支持 md/txt）。写入后教师可在资料列表看到；不要声称已经导出 Word/PPT。',
  schema: z.object({
    name: nameSchema,
    content: z.string().min(1).max(100_000)
  }),
  timeoutMs: 20_000,
  async execute(args, ctx) {
    const input = args as { name: string, content: string }
    const name = safeFileName(input.name)
    const extension = extensionOf(name)
    if (!WRITABLE_EXTENSIONS.includes(extension)) throw new Error('只能写入 md/txt 文件')
    const { client, workspaceId } = requireWorkspace(ctx)
    const data = Buffer.from(input.content, 'utf8')
    const file = await client.putFile(workspaceId, name, data)
    await trackProductEvent(ctx.event, {
      schoolId: ctx.user.schoolId,
      userId: ctx.user.userId,
      eventName: 'lesson_prep_file_written',
      targetType: 'chat_session',
      targetId: ctx.user.sessionId,
      metadata: { extension, chars: input.content.length }
    })
    return { name: file.name, size: file.size }
  }
}

export const workspaceDeleteFileTool: AgentTool = {
  name: 'workspace_delete_file',
  description: '删除工作区中的一个资料或草稿文件。只在教师明确要求删除时使用。',
  schema: z.object({ name: nameSchema }),
  timeoutMs: 20_000,
  async execute(args, ctx) {
    const name = safeFileName((args as { name: string }).name)
    const { client, workspaceId } = requireWorkspace(ctx)
    await client.deleteFile(workspaceId, name)
    await trackProductEvent(ctx.event, {
      schoolId: ctx.user.schoolId,
      userId: ctx.user.userId,
      eventName: 'lesson_prep_file_removed',
      targetType: 'chat_session',
      targetId: ctx.user.sessionId,
      metadata: { extension: extensionOf(name) }
    })
    return { name, deleted: true }
  }
}

export const workspaceTools: AgentTool[] = [
  workspaceListFilesTool,
  workspaceReadFileTool,
  workspaceWriteFileTool,
  workspaceDeleteFileTool
]
