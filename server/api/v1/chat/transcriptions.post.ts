import { z } from 'zod'
import { requireUser } from '../../../utils/auth'
import { schema, useDb } from '../../../utils/db'
import { resolveAiGovernance } from '../../../domain/ai-governance'
import { trackProductEvent } from '../../../domain/product-events'
import { speechErrorCode, transcribeAudio } from '../../../integrations/dashscope-speech'

/**
 * 录音上限（解码后字节数）：约 60 秒 16kHz 单声道 wav。
 * 已冻结契约的 base64 长度上限（8_600_000 字符）解码后约 6.1MB，这里再核对真实字节数，
 * 防止客户端伪造长度（base64 里含空白/非法字符时解码结果会短于理论值）。
 */
const MAX_AUDIO_BYTES = 6 * 1024 * 1024

/** 请求体：只接受 wav——前端录音统一转码，服务端不做格式嗅探，避免把任意二进制送上游。 */
const bodySchema = z.object({
  audioBase64: z.string().min(1).max(8_600_000),
  mimeType: z.literal('audio/wav')
})

/**
 * 首页助手语音输入：教师录音 → 转写文本。
 *
 * 只做「录音转文字」这一件事：不落盘音频、不写对话消息，转写文本由前端放进输入框，
 * 教师确认后再走普通提问链路（因此安全规则、上下文装配、会话绑定都只在一处生效）。
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event, ['teacher'])
  if (!user.schoolId) throw createError({ statusCode: 400, message: '教师未关联学校' })
  const schoolId = user.schoolId

  const config = useRuntimeConfig(event)
  // 语音总开关与密钥是部署配置问题，用 503 与「提问链路不可用」区分开
  if (!config.speechEnabled || !config.dashscopeApiKey) {
    throw createError({ statusCode: 503, message: '当前环境未开启语音能力。' })
  }
  // 数据模式门禁：local 模式承诺不出校，任何情况下都不能把音频送外部服务
  const mode = (await resolveAiGovernance(event, schoolId, user.id)).effectiveMode
  if (mode === 'local') {
    throw createError({ statusCode: 403, message: '当前学校设置为本地模式，语音能力不向外部服务发送数据。' })
  }

  const body = bodySchema.parse(await readBody(event))
  const audioBytes = Buffer.from(body.audioBase64, 'base64').byteLength
  if (audioBytes > MAX_AUDIO_BYTES) {
    throw createError({ statusCode: 413, message: '录音过长，请控制在 60 秒以内。' })
  }

  const db = useDb(event)
  const startedAt = Date.now()

  // 模型调用审计：成功与失败都记一行（只记元数据，不记音频与识别文本正文），写失败不影响教师侧响应
  const recordModelCall = (status: 'success' | 'failed', errorCode: string | null, audioTokens: number | null, latencyMs: number) =>
    db.insert(schema.aiModelCalls).values({
      schoolId,
      ownerUserId: user.id,
      provider: 'dashscope',
      model: String(config.asrModel),
      purpose: 'speech_asr',
      status,
      latencyMs,
      promptTokens: audioTokens,
      errorCode,
      dataMode: mode
    }).catch((auditError: unknown) => {
      console.warn('[chat] 语音识别审计写入失败:', auditError instanceof Error ? auditError.message : auditError)
    })

  let result: Awaited<ReturnType<typeof transcribeAudio>>
  try {
    result = await transcribeAudio({
      compatibleBaseUrl: String(config.dashscopeBaseUrl),
      apiBaseUrl: String(config.dashscopeApiBaseUrl),
      apiKey: String(config.dashscopeApiKey),
      asrModel: String(config.asrModel),
      ttsModel: String(config.ttsModel),
      ttsVoice: String(config.ttsVoice)
    }, { base64: body.audioBase64, mime: body.mimeType })
  } catch (error) {
    const code = speechErrorCode(error)
    await recordModelCall('failed', code, null, Date.now() - startedAt)
    console.warn('[chat] 语音识别失败:', code, error instanceof Error ? error.message : error)
    // 上游明确表示「没有有效语音」（qwen-audio 系列对静音返回 400 ASR_RESPONSE_HAVE_NO_WORDS）：
    // 与识别出空文本同义，按 422 让教师直接重录，而不是报「服务不可用」
    if (code === 'no_speech') {
      throw createError({ statusCode: 422, message: '没有识别到语音内容，请重试。' })
    }
    throw createError({ statusCode: 502, message: '语音识别暂时不可用，请稍后重试。' })
  }
  await recordModelCall('success', null, result.audioTokens, Date.now() - startedAt)

  const text = result.text.trim()
  // 静音或噪声录不出内容：422 让前端直接提示重录，不计入「语音输入已使用」
  if (!text) throw createError({ statusCode: 422, message: '没有识别到语音内容，请重试。' })

  await trackProductEvent(event, {
    schoolId,
    userId: user.id,
    eventName: 'assistant_voice_input_used',
    targetType: 'chat_session',
    // seconds 是上游计量值（可能缺失，记 null）；不记识别文本
    metadata: { dataMode: mode, seconds: result.seconds }
  })

  return { text }
})
