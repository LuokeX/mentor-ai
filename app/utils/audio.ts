/**
 * 语音输入用的浏览器音频工具（纯前端实现，不引入第三方依赖）。
 *
 * 录音链路：MediaRecorder 产出的容器/编码随浏览器而异（Chrome webm/opus、Safari mp4/aac、
 * Firefox ogg/opus），采样率也不可控；识别接口要求 16kHz 单声道 16bit PCM WAV，
 * 因此这里统一「解码 → 混单声道 → 线性重采样到 16kHz → 写 WAV 头」。
 */

/** 识别接口要求的采样率（Hz）。 */
export const ASR_SAMPLE_RATE = 16000
/** 单次录音上限（毫秒）：与输入区「60s」提示保持一致，避免录完才被服务端以 413 拒绝。 */
export const MAX_RECORDING_MS = 60_000
/** 单次录音上限（秒），用于界面提示。 */
export const MAX_RECORDING_SECONDS = MAX_RECORDING_MS / 1000
/** WAV 固定头长度（字节）：RIFF(12) + fmt(24) + data(8)。 */
const WAV_HEADER_BYTES = 44

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext

/** 创建 AudioContext（兼容旧 WebKit 前缀写法）。 */
export function createAudioContext(): AudioContext {
  const ctor: AudioContextConstructor | undefined = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  if (!ctor) throw new Error('audio_context_unsupported')
  return new ctor()
}

export interface LevelMeter {
  /** 0~1 的瞬时音量（时域峰值），用于驱动录音音量条。 */
  level(): number
  /** 断开分析节点；AudioContext 由调用方统一关闭。 */
  close(): void
}

/**
 * 用 AnalyserNode 的时域数据读取麦克风音量。
 * 注意：AudioContext 处于 suspended 时不会有数据流动，调用方需要先 resume()。
 */
export function createLevelMeter(context: AudioContext, stream: MediaStream): LevelMeter {
  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const data = new Uint8Array(analyser.fftSize)
  return {
    level() {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (const sample of data) {
        const amplitude = Math.abs(sample - 128) / 128
        if (amplitude > peak) peak = amplitude
      }
      return Math.min(1, peak)
    },
    close() {
      source.disconnect()
      analyser.disconnect()
    }
  }
}

/** 把录音 Blob 解码并转成 16kHz 单声道 16bit PCM WAV。 */
export async function blobToWav16k(blob: Blob): Promise<Blob> {
  const context = createAudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const channels: Float32Array[] = []
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      channels.push(decoded.getChannelData(channel))
    }
    return encodeWav16bit(
      resampleLinear(downmixToMono(channels), decoded.sampleRate, ASR_SAMPLE_RATE),
      ASR_SAMPLE_RATE
    )
  } finally {
    await context.close().catch(() => undefined)
  }
}

/** Blob → 不带 `data:` 前缀的 base64（识别接口的请求体要求）。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // 分块拼接，避免长录音时一次性 apply 超量参数
  const chunkSize = 0x2000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

/** 多声道混单声道（平均）；单声道直接原样返回，避免不必要的拷贝。 */
function downmixToMono(channels: Float32Array[]): Float32Array {
  const first = channels[0]
  if (!first) return new Float32Array(0)
  if (channels.length === 1) return first
  const mono = new Float32Array(first.length)
  for (const channel of channels) {
    for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / channels.length
  }
  return mono
}

/** 线性插值重采样（本场景是从 44.1k/48k 降到 16k，够用且无依赖）。 */
function resampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate || !input.length) return input
  const outputLength = Math.max(1, Math.round(input.length * outputRate / inputRate))
  const output = new Float32Array(outputLength)
  const step = inputRate / outputRate
  for (let i = 0; i < outputLength; i++) {
    const position = i * step
    const left = Math.floor(position)
    const right = Math.min(left + 1, input.length - 1)
    const weight = position - left
    output[i] = (input[left] ?? 0) * (1 - weight) + (input[right] ?? 0) * weight
  }
  return output
}

/** 写 44 字节 WAV 头 + 16bit PCM 数据（单声道）。 */
function encodeWav16bit(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + samples.length * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt 块长度
  view.setUint16(20, 1, true) // 编码：PCM
  view.setUint16(22, 1, true) // 声道数：1
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byteRate = 采样率 × 块对齐
  view.setUint16(32, 2, true) // 块对齐 = 声道数 × 位深/8
  view.setUint16(34, 16, true) // 位深
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(WAV_HEADER_BYTES + i * 2, Math.round(sample * 32767), true)
  }
  return new Blob([view], { type: 'audio/wav' })
}

/** 写入 4 字节 ASCII 标记（RIFF/WAVE/fmt /data）。 */
function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}
