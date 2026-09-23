import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { requireUser } from '../../../../../utils/auth'
import { schema, useDb } from '../../../../../utils/db'
import { decryptSensitive } from '../../../../../utils/crypto'
import { redactOutboundText, resolveAiGovernance } from '../../../../../domain/ai-governance'
import { trackProductEvent } from '../../../../../domain/product-events'
import { speechTextOf, splitSpeechChunks } from '../../../../../../shared/speech'
import { speechErrorCode, synthesizeSpeech } from '../../../../../integrations/dashscope-speech'

/**
 * 单条回答最多朗读前 20 片（约 6000 字）。
 * 长回答按片合成会变成几十次付费调用并让前端播很久，超出部分由前端提示「仅支持朗读前 20 段」。
 */
const MAX_SPEECH_CHUNKS = 20

const querySchema = z.object({
  chunk: z.coerce.number().int().min(0).default(0)
})

/**
 * 朗读一条助手回答的第 chunk 片。
 *
 * 服务端按「消息 + 片号」合成并返回 base64：前端只负责播放与预取下一片，
 * 切分口径与可朗读判断都在 shared/speech.ts，保证与前端一致。
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId
  const messageId = z.string().uuid().parse(getRouterParam(event, 'id'))
  const { chunk } = querySchema.parse(getQuery(event))

  const config = useRuntimeConfig(event)
  // 语音总开关与密钥是部署配置问题，用 503 与「提问链路不可用」区分开
  if (!config.speechEnabled || !config.dashscopeApiKey) {
    throw createError({ statusCode: 503, message: '当前环境未开启语音能力。' })
  }
  // 数据模式门禁：local 模式承诺不出校，回答正文不能送外部服务合成
  const mode = (await resolveAiGovernance(event, schoolId, user.id)).effectiveMode
  if (mode === 'local') {
    throw createError({ statusCode: 403, message: '当前学校设置为本地模式，语音能力不向外部服务发送数据。' })
  }

  const db = useDb(event)
  const [message] = await db.select({
    id: schema.chatMessages.id,
    sessionId: schema.chatMessages.sessionId,
    role: schema.chatMessages.role,
    contentEnc: schema.chatMessages.contentEnc
  }).from(schema.chatMessages)
    .where(and(
      eq(schema.chatMessages.id, messageId),
      eq(schema.chatMessages.ownerUserId, user.id),
      eq(schema.chatMessages.schoolId, schoolId),
      isNull(schema.chatMessages.deletedAt)
    ))
    .limit(1)
  // 只朗读助手回答：教师提问可能是口述转写，朗读它没有意义，也避免误把教师原文外发
  if (!message || message.role !== 'assistant') throw createError({ statusCode: 404, message: '消息不存在' })

  let content = ''
  try {
    content = decryptSensitive(message.contentEnc, config.encryptionKey)
  } catch (error) {
    // 解密失败与「回答里没有可朗读内容」对外表现一致，不把加密异常细节暴露给教师
    console.warn('[chat] 朗读文本解密失败:', error instanceof Error ? error.message : error)
  }
  const chunks = splitSpeechChunks(speechTextOf(content))
  if (!chunks.length) {
    throw createError({ statusCode: 409, statusMessage: 'INVALID_TRANSITION', message: '该回答没有可朗读的内容。' })
  }
  const total = Math.min(chunks.length, MAX_SPEECH_CHUNKS)
  if (chunk >= total) throw createError({ statusCode: 400, message: '朗读分片超出范围。' })

  // 外发前按学校数据模式脱敏：回答正文可能包含学生姓名、家长电话，redacted 模式下必须先过 redactPii
  const speechText = redactOutboundText(chunks[chunk]!, mode)
  const startedAt = Date.now()

  // 模型调用审计：成功与失败都记一行（只记元数据，不记朗读正文），写失败不影响教师侧响应
  const recordModelCall = (status: 'success' | 'failed', errorCode: string | null, latencyMs: number) =>
    db.insert(schema.aiModelCalls).values({
      schoolId,
      ownerUserId: user.id,
      sessionId: message.sessionId,
      provider: 'dashscope',
      model: String(config.ttsModel),
      purpose: 'speech_tts',
      status,
      latencyMs,
      promptTokens: null,
      completionTokens: null,
      errorCode,
      dataMode: mode
    }).catch((auditError: unknown) => {
      console.warn('[chat] 语音合成审计写入失败:', auditError instanceof Error ? auditError.message : auditError)
    })

  let audio: Awaited<ReturnType<typeof synthesizeSpeech>>
  try {
    audio = await synthesizeSpeech({
      compatibleBaseUrl: String(config.dashscopeBaseUrl),
      apiBaseUrl: String(config.dashscopeApiBaseUrl),
      apiKey: String(config.dashscopeApiKey),
      asrModel: String(config.asrModel),
      ttsModel: String(config.ttsModel),
      ttsVoice: String(config.ttsVoice)
    }, { text: speechText })
  } catch (error) {
    await recordModelCall('failed', speechErrorCode(error), Date.now() - startedAt)
    console.warn('[chat] 语音合成失败:', speechErrorCode(error), error instanceof Error ? error.message : error)
    throw createError({ statusCode: 502, message: '语音合成暂时不可用，请稍后重试。' })
  }
  await recordModelCall('success', null, Date.now() - startedAt)

  await trackProductEvent(event, {
    schoolId,
    userId: user.id,
    eventName: 'assistant_voice_playback_used',
    targetType: 'chat_message',
    targetId: message.id,
    // 只记分片位置与数据模式，不记朗读正文
    metadata: { dataMode: mode, chunkIndex: chunk, chunkTotal: total }
  })

  return {
    audio: Buffer.from(audio.bytes).toString('base64'),
    mime: audio.mime,
    chunk: { index: chunk, total }
  }
})
