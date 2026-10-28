/**
 * 备课资料工作区（Phase 2）。
 *
 * 把 sandbox-runner 的临时工作区绑定到教师/会话；浏览器只拿本表 id，runner ID 不外露。
 * 只存元数据，不存文件内容；文件在 runner 的 tmpfs 中，TTL 到期或教师删除时清理。
 */
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { schema, useDb } from '../utils/db'
import { writeAudit } from '../utils/audit'
import { trackProductEvent } from './product-events'
import { SandboxClientError, sandboxClient, type SandboxFile } from './sandbox-client'
import {
  LESSON_PREP_MAX_FILE_BYTES,
  lessonPrepFileExtension,
  validateLessonPrepFileName
} from './lesson-prep-files'

export {
  LESSON_PREP_MAX_FILE_BYTES,
  LESSON_PREP_SUPPORTED_EXTENSIONS,
  lessonPrepFileExtension,
  validateLessonPrepFileName
} from './lesson-prep-files'

export const LESSON_PREP_WORKSPACE_TTL_MS = 30 * 60 * 1000

export interface LessonPrepUser {
  id: string
  schoolId: string
}

export type LessonPrepWorkspaceRow = typeof schema.chatSandboxWorkspaces.$inferSelect

/** 上传入口是否可用：开关 + runner 地址/token 都就绪才返回 true（不向前端暴露地址与 token）。 */
export function lessonPrepUploadEnabled(event: H3Event): boolean {
  const config = useRuntimeConfig(event)
  return Boolean(
    config.sandboxEnabled
    && String(config.sandboxRunnerUrl || '').trim()
    && String(config.sandboxRunnerToken || '').trim()
  )
}

/** 清理/删除场景下不因 runner 配置缺失阻断本地状态收尾。 */
function safeSandboxClient(event: H3Event) {
  try {
    return sandboxClient(event)
  } catch {
    return null
  }
}

function assertUploadEnabled(event: H3Event): void {
  if (!lessonPrepUploadEnabled(event)) {
    throw createError({ statusCode: 503, message: '资料上传暂未开放' })
  }
}

async function assertSession(event: H3Event, user: LessonPrepUser, sessionId: string): Promise<void> {
  const [session] = await useDb(event).select({ id: schema.chatSessions.id, status: schema.chatSessions.status })
    .from(schema.chatSessions)
    .where(and(
      eq(schema.chatSessions.id, sessionId),
      eq(schema.chatSessions.ownerUserId, user.id),
      eq(schema.chatSessions.schoolId, user.schoolId)
    ))
    .limit(1)
  if (!session) throw createError({ statusCode: 404, message: '对话不存在' })
  if (session.status === 'archived') throw createError({ statusCode: 409, message: '对话已归档' })
}

async function expireRow(event: H3Event, row: LessonPrepWorkspaceRow): Promise<void> {
  const client = safeSandboxClient(event)
  if (client) await client.deleteWorkspace(row.providerWorkspaceId).catch(() => undefined)
  await useDb(event).update(schema.chatSandboxWorkspaces)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(
      eq(schema.chatSandboxWorkspaces.id, row.id),
      eq(schema.chatSandboxWorkspaces.ownerUserId, row.ownerUserId),
      eq(schema.chatSandboxWorkspaces.schoolId, row.schoolId)
    ))
}

async function findOwnedRow(event: H3Event, user: LessonPrepUser, workspaceId: string): Promise<LessonPrepWorkspaceRow> {
  const [row] = await useDb(event).select().from(schema.chatSandboxWorkspaces)
    .where(and(
      eq(schema.chatSandboxWorkspaces.id, workspaceId),
      eq(schema.chatSandboxWorkspaces.ownerUserId, user.id),
      eq(schema.chatSandboxWorkspaces.schoolId, user.schoolId)
    ))
    .limit(1)
  if (!row) throw createError({ statusCode: 404, message: '资料工作区不存在' })
  if (row.status !== 'active') throw createError({ statusCode: 410, message: '资料工作区已失效，请重新上传' })
  if (row.expiresAt.getTime() <= Date.now()) {
    await expireRow(event, row)
    throw createError({ statusCode: 410, message: '资料工作区已过期，请重新上传' })
  }
  return row
}

/** 会话当前绑定的有效工作区（不含过期/失效）。 */
export async function findActiveLessonPrepWorkspaceForSession(
  event: H3Event,
  user: LessonPrepUser,
  sessionId: string
): Promise<LessonPrepWorkspaceRow | null> {
  if (!lessonPrepUploadEnabled(event)) return null
  const [row] = await useDb(event).select().from(schema.chatSandboxWorkspaces)
    .where(and(
      eq(schema.chatSandboxWorkspaces.sessionId, sessionId),
      eq(schema.chatSandboxWorkspaces.ownerUserId, user.id),
      eq(schema.chatSandboxWorkspaces.schoolId, user.schoolId),
      eq(schema.chatSandboxWorkspaces.status, 'active'),
      gt(schema.chatSandboxWorkspaces.expiresAt, new Date())
    ))
    .orderBy(desc(schema.chatSandboxWorkspaces.createdAt))
    .limit(1)
  return row ?? null
}

/** 会话详情用：只返回本表 id，不返回 runner ID。 */
export async function lessonPrepWorkspaceIdForSession(
  event: H3Event,
  user: LessonPrepUser,
  sessionId: string
): Promise<string | null> {
  const row = await findActiveLessonPrepWorkspaceForSession(event, user, sessionId)
  return row?.id ?? null
}

/** 创建（或复用会话已有的）工作区。 */
export async function createLessonPrepWorkspace(
  event: H3Event,
  user: LessonPrepUser,
  sessionId?: string | null
): Promise<LessonPrepWorkspaceRow> {
  assertUploadEnabled(event)
  if (sessionId) {
    await assertSession(event, user, sessionId)
    const existing = await findActiveLessonPrepWorkspaceForSession(event, user, sessionId)
    if (existing) return existing
  }
  const client = sandboxClient(event)
  if (!client) throw createError({ statusCode: 503, message: '资料上传暂未开放' })
  let providerWorkspaceId: string
  try {
    providerWorkspaceId = await client.createWorkspace()
  } catch (error) {
    throw mapSandboxError(error)
  }
  const db = useDb(event)
  const [row] = await db.insert(schema.chatSandboxWorkspaces).values({
    schoolId: user.schoolId,
    ownerUserId: user.id,
    sessionId: sessionId || null,
    providerWorkspaceId,
    expiresAt: new Date(Date.now() + LESSON_PREP_WORKSPACE_TTL_MS)
  }).returning()
  if (!row) {
    await client.deleteWorkspace(providerWorkspaceId).catch(() => undefined)
    throw createError({ statusCode: 500, message: '资料工作区创建失败' })
  }
  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'chat.lesson_prep.workspace.create',
    targetType: 'chat_sandbox_workspace',
    targetId: row.id,
    metadata: { sessionBound: Boolean(sessionId) }
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId,
    userId: user.id,
    eventName: 'lesson_prep_workspace_created',
    targetType: 'chat_sandbox_workspace',
    targetId: row.id,
    metadata: { sessionBound: Boolean(sessionId) }
  })
  return row
}

/**
 * 发消息时解析工作区：显式 ID 优先，未传则用会话当前绑定的工作区。
 * 未绑定会话的工作区在这里绑定到本轮会话；已绑定到别的会话返回 409。
 */
export async function resolveLessonPrepWorkspaceForChat(
  event: H3Event,
  user: LessonPrepUser,
  workspaceId: string | null | undefined,
  sessionId: string
): Promise<LessonPrepWorkspaceRow | null> {
  if (!lessonPrepUploadEnabled(event)) return null
  if (!workspaceId) return findActiveLessonPrepWorkspaceForSession(event, user, sessionId)
  const row = await findOwnedRow(event, user, workspaceId)
  if (row.sessionId && row.sessionId !== sessionId) {
    throw createError({ statusCode: 409, message: '该资料工作区已绑定其他对话' })
  }
  if (!row.sessionId) {
    try {
      const [bound] = await useDb(event).update(schema.chatSandboxWorkspaces)
        .set({ sessionId, updatedAt: new Date() })
        .where(and(
          eq(schema.chatSandboxWorkspaces.id, row.id),
          eq(schema.chatSandboxWorkspaces.ownerUserId, user.id),
          eq(schema.chatSandboxWorkspaces.schoolId, user.schoolId),
          isNull(schema.chatSandboxWorkspaces.sessionId)
        ))
        .returning()
      if (bound) return bound
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') {
        throw createError({ statusCode: 409, message: '该对话已有资料工作区' })
      }
      throw error
    }
  }
  const latest = await findOwnedRow(event, user, workspaceId)
  if (latest.sessionId && latest.sessionId !== sessionId) {
    throw createError({ statusCode: 409, message: '该资料工作区已绑定其他对话' })
  }
  return latest
}

/** 上传一个资料文件；大小/类型在 app 与 runner 双侧校验。 */
export async function uploadLessonPrepFile(
  event: H3Event,
  user: LessonPrepUser,
  workspaceId: string,
  filename: string,
  data: Buffer
): Promise<SandboxFile> {
  assertUploadEnabled(event)
  const name = validateLessonPrepFileName(filename)
  if (!data.length) throw createError({ statusCode: 400, message: '文件内容为空' })
  if (data.length > LESSON_PREP_MAX_FILE_BYTES) {
    throw createError({ statusCode: 413, message: '单个文件不能超过 20MB' })
  }
  const row = await findOwnedRow(event, user, workspaceId)
  const client = sandboxClient(event)
  if (!client) throw createError({ statusCode: 503, message: '资料上传暂未开放' })
  let file: SandboxFile
  try {
    file = await client.putFile(row.providerWorkspaceId, name, data)
  } catch (error) {
    throw mapSandboxError(error)
  }
  const extension = lessonPrepFileExtension(name)
  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'chat.lesson_prep.file.upload',
    targetType: 'chat_sandbox_workspace',
    targetId: row.id,
    metadata: { extension, size: data.length }
  })
  await trackProductEvent(event, {
    schoolId: user.schoolId,
    userId: user.id,
    eventName: 'lesson_prep_file_uploaded',
    targetType: 'chat_sandbox_workspace',
    targetId: row.id,
    metadata: { extension, size: data.length }
  })
  return file
}

export async function listLessonPrepFiles(
  event: H3Event,
  user: LessonPrepUser,
  workspaceId: string
): Promise<SandboxFile[]> {
  assertUploadEnabled(event)
  const row = await findOwnedRow(event, user, workspaceId)
  const client = sandboxClient(event)
  if (!client) throw createError({ statusCode: 503, message: '资料上传暂未开放' })
  try {
    return await client.listFiles(row.providerWorkspaceId)
  } catch (error) {
    throw mapSandboxError(error)
  }
}

export async function deleteLessonPrepFile(
  event: H3Event,
  user: LessonPrepUser,
  workspaceId: string,
  filename: string
): Promise<void> {
  assertUploadEnabled(event)
  const name = validateLessonPrepFileName(filename)
  const row = await findOwnedRow(event, user, workspaceId)
  const client = sandboxClient(event)
  if (!client) throw createError({ statusCode: 503, message: '资料上传暂未开放' })
  try {
    await client.deleteFile(row.providerWorkspaceId, name)
  } catch (error) {
    throw mapSandboxError(error)
  }
  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'chat.lesson_prep.file.delete',
    targetType: 'chat_sandbox_workspace',
    targetId: row.id,
    metadata: { extension: lessonPrepFileExtension(name) }
  })
}

export async function deleteLessonPrepWorkspace(
  event: H3Event,
  user: LessonPrepUser,
  workspaceId: string
): Promise<void> {
  const row = await findOwnedRow(event, user, workspaceId)
  const client = safeSandboxClient(event)
  if (client) await client.deleteWorkspace(row.providerWorkspaceId).catch(() => undefined)
  await useDb(event).update(schema.chatSandboxWorkspaces)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(and(
      eq(schema.chatSandboxWorkspaces.id, row.id),
      eq(schema.chatSandboxWorkspaces.ownerUserId, user.id),
      eq(schema.chatSandboxWorkspaces.schoolId, user.schoolId)
    ))
  await writeAudit(event, {
    schoolId: user.schoolId,
    actorId: user.id,
    action: 'chat.lesson_prep.workspace.delete',
    targetType: 'chat_sandbox_workspace',
    targetId: row.id
  })
}

function mapSandboxError(error: unknown): Error {
  if (error instanceof SandboxClientError) {
    const statusCode = error.statusCode === 413 || error.statusCode === 415 ? error.statusCode : 502
    return createError({ statusCode, message: error.message })
  }
  return error instanceof Error ? error : new Error('资料服务暂时不可用')
}
