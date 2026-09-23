import { z } from 'zod'

export interface DashScopeSpeechOptions {
  /** OpenAI 兼容端点：语音识别（qwen3-asr-flash）走这里。 */
  compatibleBaseUrl: string
  /** DashScope 原生端点：语音合成（qwen3-tts-flash）走这里。 */
  apiBaseUrl: string
  apiKey: string
  asrModel: string
  ttsModel: string
  ttsVoice: string
}

/** 语音识别上限：60 秒以内的 wav 正常几秒内返回，30 秒兜底，避免请求把 Worker 挂住。 */
export const ASR_TIMEOUT_MS = 30000
/** 合成上限：长文本分片后单片通常 1-3 秒返回，60 秒兜底。 */
export const TTS_SYNTHESIS_TIMEOUT_MS = 60000
/** 音频下载上限：签名地址是对象存储直链，只用于立刻取回字节。 */
export const TTS_DOWNLOAD_TIMEOUT_MS = 20000
/** 朗读音频体积上限：合成结果通常是几百 KB 的 wav，8MB 足够且能挡住异常大响应。 */
export const MAX_TTS_AUDIO_BYTES = 8 * 1024 * 1024

/**
 * 上游错误码约定（只用于写 `ai_model_calls.error_code`，给运营侧分辨失败原因，不返回给教师）：
 * - `timeout`：本地超时（ASR 30s / TTS 合成 60s / 音频下载 20s）
 * - `http:<status>`：上游非 2xx
 * - `no_speech`：上游明确表示「没有有效语音」（`qwen-audio` 系列对静音返回 400 `ASR_RESPONSE_HAVE_NO_WORDS`），
 *   调用方按 422 让教师重录，而不是当成服务故障
 * - `schema`：上游返回体不是预期形状（含返回体不是合法 JSON）
 * - `oversize`：朗读音频超过体积上限
 * - `unknown`：其它（DNS/连接中断等网络错误）
 */
export function speechErrorCode(error: unknown): string {
  const code = (error as { speechCode?: unknown } | null)?.speechCode
  return typeof code === 'string' && code ? code : 'unknown'
}

function speechError(code: string, message: string): Error {
  const error = new Error(message)
  ;(error as Error & { speechCode?: string }).speechCode = code
  return error
}

/** 统一挂超时并归一化错误：AbortSignal.timeout 触发时 fetch 抛的是 name=TimeoutError，这里换成稳定错误码。 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw speechError('timeout', `DashScope speech ${label} timeout after ${timeoutMs}ms`)
    }
    throw error
  }
}

/** 非 2xx 统一抛错：只带状态码与上游前 200 字符，绝不含 apiKey。
 *  截断既是避免把整段上游报文写进日志，也避免上游异常时回显业务正文。
 *  noSpeechMarkers：上游把「没有有效语音」也当 4xx 返回（qwen-audio 系列是 400 ASR_RESPONSE_HAVE_NO_WORDS），
 *  命中时抛 `no_speech` 而不是 `http:400`，调用方据此给教师「没有识别到语音内容」而不是「服务不可用」。 */
async function assertUpstreamOk(response: Response, label: string, options: { noSpeechMarkers?: string[] } = {}) {
  if (response.ok) return
  const detail = await response.text().catch(() => '')
  if (options.noSpeechMarkers?.some(marker => detail.includes(marker))) {
    throw speechError('no_speech', `DashScope speech ${label} no speech detected: ${detail.slice(0, 200)}`)
  }
  throw speechError(`http:${response.status}`, `DashScope speech ${label} ${response.status}: ${detail.slice(0, 200)}`)
}

async function readUpstreamJson<T>(response: Response, schema: z.ZodType<T>, label: string): Promise<T> {
  const payload = await response.json().catch(() => undefined)
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw speechError('schema', `DashScope speech ${label} response shape mismatch`)
  return parsed.data
}

/** 语音识别响应：两种系列形状不同，命中任一即可，缺字段由 parseAsrText 判定形状不符。
 *  - Qwen-ASR（qwen3-asr-*，OpenAI 兼容）：`choices[0].message.content`，静音时为 null。
 *  - Qwen-Audio（qwen-audio-*，原生）：顶层 `text`（`output.text` 是同一份镜像），`usage.duration` 为音频秒数。
 */
const asrResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() })
  })).min(1).optional(),
  text: z.string().nullable().optional(),
  output: z.object({ text: z.string().nullable().optional() }).nullish(),
  usage: z.object({
    seconds: z.number().nullish(),
    duration: z.number().nullish(),
    prompt_tokens_details: z.object({ audio_tokens: z.number().nullish() }).nullish()
  }).nullish()
})

type AsrResponse = z.infer<typeof asrResponseSchema>

/** 从两种形状里取识别文本：null 表示静音（交回路由判 422），undefined 表示形状不符（按 schema 错误处理）。 */
function parseAsrText(parsed: AsrResponse): string | undefined {
  if (Array.isArray(parsed.choices)) return parsed.choices[0]?.message.content ?? ''
  if (typeof parsed.text === 'string') return parsed.text
  if (typeof parsed.output?.text === 'string') return parsed.output.text
  if (parsed.text === null || parsed.output?.text === null) return ''
  return undefined
}

/**
 * 语音识别的端点与请求体随模型系列不同，和 TTS 一样按模型名前缀选择：
 * - Qwen-ASR（`qwen3-asr-*`）：OpenAI 兼容 `/chat/completions`，音频放 `input_audio.data`（data URL）。
 * - Qwen-Audio（`qwen-audio-*`）：原生 `/services/aigc/multimodal-generation/generation`，音频放
 *   `input.messages[].content[].audio`，而且**必须显式传 `parameters.format`**——省略时上游返回
 *   400 `UNSUPPORTED_FORMAT`「format is empty」（2026-09-21 实测），两种域名（业务空间与官方）都一样。
 */
export function asrRequest(
  model: string,
  input: { base64: string, mime: string },
  baseUrls: { compatibleBaseUrl: string, apiBaseUrl: string }
): { url: string, body: object } {
  const dataUrl = `data:${input.mime};base64,${input.base64}`
  if (/^qwen-audio-/i.test(model)) {
    return {
      url: `${baseUrls.apiBaseUrl.replace(/\/$/, '')}/services/aigc/multimodal-generation/generation`,
      body: {
        model,
        input: { messages: [{ role: 'user', content: [{ audio: dataUrl }] }] },
        // format 必须与前端录音转码格式一致（wav），省略会被上游以 400 UNSUPPORTED_FORMAT 拒绝；
        // language 固定中文、enable_itn 打开数字归一化，与 qwen3 系列的口径保持一致
        parameters: { format: 'wav', language: 'zh', enable_itn: true }
      }
    }
  }
  return {
    url: `${baseUrls.compatibleBaseUrl.replace(/\/$/, '')}/chat/completions`,
    body: {
      model,
      messages: [{
        role: 'user',
        content: [{
          type: 'input_audio',
          // 百炼要求 data URL 形式（data:<mime>;base64,<payload>）
          input_audio: { data: dataUrl }
        }]
      }],
      // 教师语音固定中文；enable_itn 打开数字/日期归一化，避免出现「一三九」这类字面转写
      asr_options: { language: 'zh', enable_itn: true }
    }
  }
}

/**
 * 语音转文字（默认 qwen-audio-3.0-asr-flash，端点见 `asrRequest`）。
 * 只返回文本与计量信息，不落盘音频；调用方负责写审计与产品事件。
 */
export async function transcribeAudio(
  options: DashScopeSpeechOptions,
  input: { base64: string, mime: string }
): Promise<{ text: string, seconds: number | null, audioTokens: number | null }> {
  const request = asrRequest(options.asrModel, input, options)
  const response = await fetchWithTimeout(request.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`
    },
    body: JSON.stringify(request.body)
  }, ASR_TIMEOUT_MS, 'ASR')
  await assertUpstreamOk(response, 'ASR', { noSpeechMarkers: ['ASR_RESPONSE_HAVE_NO_WORDS'] })
  const parsed = await readUpstreamJson(response, asrResponseSchema, 'ASR')
  const text = parseAsrText(parsed)
  if (text === undefined) throw speechError('schema', 'DashScope speech ASR response shape mismatch')
  return {
    text,
    // Qwen-ASR 用 usage.seconds，Qwen-Audio 用 usage.duration（两者都是秒）
    seconds: parsed.usage?.seconds ?? parsed.usage?.duration ?? null,
    audioTokens: parsed.usage?.prompt_tokens_details?.audio_tokens ?? null
  }
}

/** 合成响应（原生 multimodal-generation / SpeechSynthesizer 两种形状的公共部分）：只需要音频地址。 */
const ttsSynthesisResponseSchema = z.object({
  output: z.object({
    audio: z.object({ url: z.string().min(1) })
  })
})

/**
 * 语音合成的端点与请求体随模型系列不同，官方文档明确「端点不可混用」：
 * - Qwen-Audio-TTS（`qwen-audio-*`）与 CosyVoice（`cosyvoice-*`）：走 `/services/audio/tts/SpeechSynthesizer`，
 *   入参是 text / voice / format / sample_rate（这一族不吃 `language_type`）。
 * - Qwen-TTS（`qwen3-tts-*`、`qwen-tts-*`）：走 `/services/aigc/multimodal-generation/generation`，入参带 `language_type`。
 * 用 Qwen-TTS 的端点调 `qwen-audio-3.0-tts-flash` 会被上游以 400 InvalidParameter 直接拒绝（2026-09-21 实测），
 * 所以这里按模型名前缀选择端点，避免只改 TTS_MODEL 就静默失败。
 */
export function ttsSynthesisRequest(model: string, input: { text: string, voice: string }): { path: string, body: object } {
  if (/^(?:qwen-audio-|cosyvoice-)/i.test(model)) {
    return {
      path: '/services/audio/tts/SpeechSynthesizer',
      // format=wav 与前端播放、mime 兜底一致；sample_rate 用官方示例值
      body: { model, input: { text: input.text, voice: input.voice, format: 'wav', sample_rate: 24000 } }
    }
  }
  return {
    path: '/services/aigc/multimodal-generation/generation',
    body: { model, input: { text: input.text, voice: input.voice, language_type: 'Chinese' } }
  }
}

/**
 * 文字转语音（默认 qwen-audio-3.0-tts-flash + longanlingxi，见 `ttsSynthesisRequest` 的端点说明）。
 *
 * 两步：先合成拿到一次性签名 URL，再用普通 GET 把字节取回。
 * 为什么在服务端取回字节而不把 URL 透传前端：一是签名地址会过期、前端播放失败难排查，
 * 二是地址属于上游实现细节，暴露出去等于把音频内容交给浏览器直连第三方；同时服务端可以统一限制体积。
 */
export async function synthesizeSpeech(
  options: DashScopeSpeechOptions,
  input: { text: string }
): Promise<{ bytes: Uint8Array, mime: string }> {
  const baseUrl = options.apiBaseUrl.replace(/\/$/, '')
  const request = ttsSynthesisRequest(options.ttsModel, { text: input.text, voice: options.ttsVoice })
  const synthesis = await fetchWithTimeout(`${baseUrl}${request.path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`
    },
    body: JSON.stringify(request.body)
  }, TTS_SYNTHESIS_TIMEOUT_MS, 'TTS synthesis')
  await assertUpstreamOk(synthesis, 'TTS synthesis')
  const parsed = await readUpstreamJson(synthesis, ttsSynthesisResponseSchema, 'TTS synthesis')

  const download = await fetchWithTimeout(parsed.output.audio.url, { method: 'GET' }, TTS_DOWNLOAD_TIMEOUT_MS, 'TTS download')
  await assertUpstreamOk(download, 'TTS download')
  // 先看响应头声明的长度，再核对实际字节数：两条都查，避免上游漏写 content-length 时把大对象读进内存
  const declaredBytes = Number(download.headers.get('content-length') || 0)
  if (declaredBytes > MAX_TTS_AUDIO_BYTES) {
    throw speechError('oversize', `DashScope speech TTS audio too large: ${declaredBytes} bytes`)
  }
  const bytes = new Uint8Array(await download.arrayBuffer())
  if (bytes.byteLength > MAX_TTS_AUDIO_BYTES) {
    throw speechError('oversize', `DashScope speech TTS audio too large: ${bytes.byteLength} bytes`)
  }

  // content-type 可能带参数（audio/wav; charset=…），只取媒体类型本身；缺失时按 wav 兜底
  const mime = (download.headers.get('content-type') || '').split(';')[0]?.trim() || 'audio/wav'
  return { bytes, mime }
}
