import { afterEach, describe, expect, it, vi } from 'vitest'
import { speechTextOf, splitSpeechChunks } from '../shared/speech'
import {
  asrRequest,
  MAX_TTS_AUDIO_BYTES,
  speechErrorCode,
  synthesizeSpeech,
  transcribeAudio,
  ttsSynthesisRequest,
  type DashScopeSpeechOptions
} from '../server/integrations/dashscope-speech'

afterEach(() => vi.unstubAllGlobals())

const speechOptions: DashScopeSpeechOptions = {
  compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  apiKey: 'sk-test',
  asrModel: 'qwen3-asr-flash',
  // 通用用例按 OpenAI 兼容形状（qwen3-*）跑；生产默认是 qwen-audio-3.0-asr-flash 与 qwen-audio-3.0-tts-flash，
  // 这两族的端点/请求体/返回结构由 asrRequest、ttsSynthesisRequest 的专门用例覆盖
  ttsModel: 'qwen3-tts-flash',
  ttsVoice: 'Cherry'
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

describe('speechTextOf', () => {
  it('去掉围栏代码块内容与表格分隔行，保留其余正文', () => {
    const markdown = [
      '建议如下：',
      '```ts',
      'const suggestion = "先观察一周"',
      '```',
      '| 项目 | 说明 |',
      '| --- | :---: |',
      '| 睡眠 | 需继续观察 |'
    ].join('\n')

    expect(speechTextOf(markdown)).toBe([
      '建议如下：',
      '| 项目 | 说明 |',
      '| 睡眠 | 需继续观察 |'
    ].join('\n'))
  })

  it('链接保留文字去掉 URL，图片保留 alt 文字', () => {
    expect(speechTextOf('参考[量表说明](https://example.com/doc?x=1)与[引用][ref]。'))
      .toBe('参考量表说明与引用。')
    expect(speechTextOf('见图![课堂流程图](https://example.com/a.png)后再判断。'))
      .toBe('见图课堂流程图后再判断。')
    expect(speechTextOf('地址 <https://example.com/doc> 自动链接不朗读。'))
      .toBe('地址 自动链接不朗读。')
  })

  it('去掉标题、引用、强调与列表标记', () => {
    const markdown = [
      '# 处理建议',
      '> 先稳定情绪',
      '**重点**：与*家长*沟通，~~不必~~急着下结论',
      '- 第一步',
      '1. 第二步',
      '`owner_user_id` 字段保持不变'
    ].join('\n')

    expect(speechTextOf(markdown)).toBe([
      '处理建议',
      '先稳定情绪',
      '重点：与家长沟通，不必急着下结论',
      '第一步',
      '第二步',
      'owner_user_id 字段保持不变'
    ].join('\n'))
  })

  it('未闭合的代码块吃掉剩余内容，整条只有代码块时返回空串', () => {
    expect(speechTextOf('先给结论\n```\nconsole.log(1)')).toBe('先给结论')
    expect(speechTextOf('```\nconsole.log(1)\n```')).toBe('')
    expect(speechTextOf('')).toBe('')
  })

  it('压缩多余空行与空白', () => {
    expect(speechTextOf('  第一行  \n\n\n\n第二行\t\t结束  ')).toBe('第一行\n\n第二行 结束')
  })
})

describe('splitSpeechChunks', () => {
  it('按句末标点与换行切分，空分片丢弃', () => {
    expect(splitSpeechChunks('第一句。第二句！第三句？')).toEqual(['第一句。', '第二句！', '第三句？'])
    expect(splitSpeechChunks('第一句。\n\n\n第二句')).toEqual(['第一句。', '第二句'])
    expect(splitSpeechChunks('只问一句？')).toEqual(['只问一句？'])
  })

  it('超长单句按 maxChars 硬切且每片不超过上限', () => {
    const long = '字'.repeat(650)
    const chunks = splitSpeechChunks(long)

    expect(chunks.map(chunk => chunk.length)).toEqual([300, 300, 50])
    expect(chunks.join('')).toBe(long)
  })

  it('支持自定义 maxChars', () => {
    expect(splitSpeechChunks('abcd'.repeat(3), 4)).toEqual(['abcd', 'abcd', 'abcd'])
  })

  it('空串与纯空白返回空数组', () => {
    expect(splitSpeechChunks('')).toEqual([])
    expect(splitSpeechChunks('   \n  ')).toEqual([])
  })

  it('真实回答经清洗后可以整段按片朗读且每片都不超上限', () => {
    const answer = [
      '## 初步判断',
      '这位同学最近两周的表现更像**注意力维持困难**，先按下面三步做：',
      '1. 今天找一次短谈话，只问事实，不下结论。',
      '2. 与家长确认[家校沟通记录](https://example.com/x)里的睡眠时间。',
      '',
      '```js',
      'console.log("不要把这段念出来")',
      '```',
      '',
      '> 如果伴随情绪低落或自伤表述，请立刻走转介流程。'
    ].join('\n')

    const text = speechTextOf(answer)
    expect(text).not.toContain('不要把这段念出来')
    expect(text).not.toContain('https://example.com/x')
    expect(text).not.toContain('##')

    const chunks = splitSpeechChunks(text)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every(chunk => chunk.length <= 300 && chunk.length > 0)).toBe(true)
  })
})

describe('transcribeAudio', () => {
  it('asrRequest 按模型系列选择端点与入参：qwen-audio 走原生并显式带 format，qwen3-asr 走 OpenAI 兼容', () => {
    const baseUrls = {
      compatibleBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiBaseUrl: 'https://dashscope.aliyuncs.com/api/v1'
    }
    // qwen-audio 系列省略 parameters.format 会被上游以 400 UNSUPPORTED_FORMAT 拒绝，必须带上
    expect(asrRequest('qwen-audio-3.0-asr-flash', { base64: 'QUJD', mime: 'audio/wav' }, baseUrls)).toEqual({
      url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      body: {
        model: 'qwen-audio-3.0-asr-flash',
        input: { messages: [{ role: 'user', content: [{ audio: 'data:audio/wav;base64,QUJD' }] }] },
        parameters: { format: 'wav', language: 'zh', enable_itn: true }
      }
    })
    expect(asrRequest('qwen3-asr-flash', { base64: 'QUJD', mime: 'audio/wav' }, baseUrls)).toEqual({
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      body: {
        model: 'qwen3-asr-flash',
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,QUJD' } }] }],
        asr_options: { language: 'zh', enable_itn: true }
      }
    })
  })

  it('qwen-audio 系列：顶层 text 形状可解析，秒数取 usage.duration', async () => {
    const audioOptions: DashScopeSpeechOptions = { ...speechOptions, asrModel: 'qwen-audio-3.0-asr-flash' }
    const fetchMock = vi.fn(async () => jsonResponse({
      sentence: { sentence_id: 1, text: '先确认一下班里最近的情况。', sentence_end: true },
      text: '先确认一下班里最近的情况。',
      output: { text: '先确认一下班里最近的情况。' },
      usage: { duration: 2 }
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(transcribeAudio(audioOptions, { base64: 'QUJD', mime: 'audio/wav' }))
      .resolves.toEqual({ text: '先确认一下班里最近的情况。', seconds: 2, audioTokens: null })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(JSON.parse(String(init.body)).parameters).toEqual({ format: 'wav', language: 'zh', enable_itn: true })
  })

  it('qwen-audio 系列：两种形状都缺文本时按 schema 错误处理', async () => {
    const audioOptions: DashScopeSpeechOptions = { ...speechOptions, asrModel: 'qwen-audio-3.0-asr-flash' }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ request_id: 'x', usage: { duration: 1 } })))

    const error = await transcribeAudio(audioOptions, { base64: 'QUJD', mime: 'audio/wav' }).catch(item => item)
    expect(speechErrorCode(error)).toBe('schema')
  })

  it('qwen-audio 系列：静音被上游以 400 ASR_RESPONSE_HAVE_NO_WORDS 拒绝时归为 no_speech（路由据此回 422）', async () => {
    const audioOptions: DashScopeSpeechOptions = { ...speechOptions, asrModel: 'qwen-audio-3.0-asr-flash' }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      request_id: 'x',
      code: 'CLIENT_ERROR',
      message: 'ASR_RESPONSE_HAVE_NO_WORDS'
    }, 400)))

    const error = await transcribeAudio(audioOptions, { base64: 'QUJD', mime: 'audio/wav' }).catch(item => item)
    expect(speechErrorCode(error)).toBe('no_speech')
  })

  it('按 OpenAI 兼容形状请求 ASR，并解析文本与计量字段', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      choices: [{ message: { content: '明天先找小明聊一次。' } }],
      usage: { seconds: 4.2, prompt_tokens_details: { audio_tokens: 37 } }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await transcribeAudio(speechOptions, { base64: 'QUJD', mime: 'audio/wav' })

    expect(result).toEqual({ text: '明天先找小明聊一次。', seconds: 4.2, audioTokens: 37 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk-test' })
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('qwen3-asr-flash')
    expect(body.asr_options).toEqual({ language: 'zh', enable_itn: true })
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content[0]).toEqual({
      type: 'input_audio',
      input_audio: { data: 'data:audio/wav;base64,QUJD' }
    })
  })

  it('上游未返回计量字段时秒数与音频 token 为 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      choices: [{ message: { content: '好的。' } }]
    })))

    await expect(transcribeAudio(speechOptions, { base64: 'QUJD', mime: 'audio/wav' }))
      .resolves.toEqual({ text: '好的。', seconds: null, audioTokens: null })
  })

  it('非 2xx 抛错：错误信息只带状态码与上游前 200 字符，不含 apiKey', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(400), { status: 401 })))

    const error = await transcribeAudio(speechOptions, { base64: 'QUJD', mime: 'audio/wav' }).catch(item => item)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('DashScope speech ASR 401')
    expect((error as Error).message).toContain('x'.repeat(200))
    expect((error as Error).message).not.toContain('x'.repeat(201))
    expect((error as Error).message).not.toContain('sk-test')
    expect(speechErrorCode(error)).toBe('http:401')
  })

  it('超时抛错并给出 timeout 错误码', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    }))

    const error = await transcribeAudio(speechOptions, { base64: 'QUJD', mime: 'audio/wav' }).catch(item => item)

    expect((error as Error).message).toContain('timeout after 30000ms')
    expect(speechErrorCode(error)).toBe('timeout')
  })

  it('返回体形状不符（choices 为空或缺 content）抛 schema 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [] })))
    const emptyChoices = await transcribeAudio(speechOptions, { base64: 'QUJD', mime: 'audio/wav' }).catch(item => item)
    expect(speechErrorCode(emptyChoices)).toBe('schema')

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [{ message: {} }] })))
    const missingContent = await transcribeAudio(speechOptions, { base64: 'QUJD', mime: 'audio/wav' }).catch(item => item)
    expect(speechErrorCode(missingContent)).toBe('schema')
  })

  it('content 为 null（静音录音）时返回空串交给路由判 422', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      choices: [{ message: { content: null } }]
    })))

    await expect(transcribeAudio(speechOptions, { base64: 'QUJD', mime: 'audio/wav' }))
      .resolves.toEqual({ text: '', seconds: null, audioTokens: null })
  })
})

describe('ttsSynthesisRequest', () => {
  it('按模型系列选择端点与入参：qwen-audio/cosyvoice 用 SpeechSynthesizer，qwen3-tts 用 multimodal-generation', () => {
    // 换模型系列必须同时换端点：用 Qwen-TTS 的端点调 qwen-audio-3.0-tts-flash 会被上游 400 拒绝
    expect(ttsSynthesisRequest('qwen-audio-3.0-tts-flash', { text: '你好。', voice: 'longanlingxi' })).toEqual({
      path: '/services/audio/tts/SpeechSynthesizer',
      body: {
        model: 'qwen-audio-3.0-tts-flash',
        input: { text: '你好。', voice: 'longanlingxi', format: 'wav', sample_rate: 24000 }
      }
    })
    expect(ttsSynthesisRequest('cosyvoice-v3-flash', { text: '你好。', voice: 'longanyang' }).path)
      .toBe('/services/audio/tts/SpeechSynthesizer')
    expect(ttsSynthesisRequest('qwen3-tts-flash', { text: '你好。', voice: 'Cherry' })).toEqual({
      path: '/services/aigc/multimodal-generation/generation',
      body: { model: 'qwen3-tts-flash', input: { text: '你好。', voice: 'Cherry', language_type: 'Chinese' } }
    })
  })
})

describe('synthesizeSpeech', () => {
  it('qwen-audio 系列实际请求 SpeechSynthesizer 端点并取回字节', async () => {
    const audioTtsOptions: DashScopeSpeechOptions = {
      ...speechOptions,
      ttsModel: 'qwen-audio-3.0-tts-flash',
      ttsVoice: 'longanlingxi'
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/services/audio/tts/SpeechSynthesizer')) {
        return jsonResponse({ output: { audio: { url: 'https://download.example.com/tts/g.wav' } } })
      }
      return new Response(new Uint8Array([5, 6]), { status: 200, headers: { 'content-type': 'audio/wav' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(synthesizeSpeech(audioTtsOptions, { text: '第一片。' })).resolves.toMatchObject({ mime: 'audio/wav' })

    const [synthesisUrl, synthesisInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(synthesisUrl).toBe('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer')
    expect(JSON.parse(String(synthesisInit.body))).toEqual({
      model: 'qwen-audio-3.0-tts-flash',
      input: { text: '第一片。', voice: 'longanlingxi', format: 'wav', sample_rate: 24000 }
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('先请求原生端点合成，再取回音频字节并只返回 bytes/mime', async () => {
    const audio = [1, 2, 3, 4]
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('multimodal-generation')) {
        return jsonResponse({ output: { audio: { url: 'https://download.example.com/tts/a.wav?sign=abc' } } })
      }
      return new Response(new Uint8Array(audio), { status: 200, headers: { 'content-type': 'audio/wav' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await synthesizeSpeech(speechOptions, { text: '第一片。' })

    expect(Array.from(result.bytes)).toEqual(audio)
    expect(result.mime).toBe('audio/wav')
    // 音频地址是上游实现细节，不能返回给调用方
    expect(Object.keys(result).sort()).toEqual(['bytes', 'mime'])
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [synthesisUrl, synthesisInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(synthesisUrl).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
    expect(synthesisInit.method).toBe('POST')
    expect(synthesisInit.headers).toMatchObject({ authorization: 'Bearer sk-test' })
    expect(JSON.parse(String(synthesisInit.body))).toEqual({
      model: 'qwen3-tts-flash',
      input: { text: '第一片。', voice: 'Cherry', language_type: 'Chinese' }
    })

    const [downloadUrl, downloadInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
    expect(downloadUrl).toBe('https://download.example.com/tts/a.wav?sign=abc')
    expect(downloadInit.method).toBe('GET')
    // 签名地址自带鉴权，下载不再带 apiKey
    expect(downloadInit.headers).toBeUndefined()
  })

  it('content-type 带参数时只取媒体类型，缺失时兜底 audio/wav', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('multimodal-generation')) {
        return jsonResponse({ output: { audio: { url: 'https://download.example.com/tts/b.wav' } } })
      }
      return new Response(new Uint8Array([9]), { status: 200, headers: { 'content-type': 'audio/wav; charset=binary' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(synthesizeSpeech(speechOptions, { text: '第二片。' })).resolves.toMatchObject({ mime: 'audio/wav' })

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('multimodal-generation')) {
        return jsonResponse({ output: { audio: { url: 'https://download.example.com/tts/c.wav' } } })
      }
      return new Response(new Uint8Array([9]), { status: 200 })
    }))
    await expect(synthesizeSpeech(speechOptions, { text: '第三片。' })).resolves.toMatchObject({ mime: 'audio/wav' })
  })

  it('合成步骤非 2xx 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid api key', { status: 400 })))

    const error = await synthesizeSpeech(speechOptions, { text: '第一片。' }).catch(item => item)

    expect((error as Error).message).toContain('DashScope speech TTS synthesis 400')
    expect((error as Error).message).not.toContain('sk-test')
    expect(speechErrorCode(error)).toBe('http:400')
  })

  it('音频下载非 2xx 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('multimodal-generation')) {
        return jsonResponse({ output: { audio: { url: 'https://download.example.com/tts/d.wav' } } })
      }
      return new Response('expired', { status: 403 })
    }))

    const error = await synthesizeSpeech(speechOptions, { text: '第一片。' }).catch(item => item)

    expect((error as Error).message).toContain('DashScope speech TTS download 403')
    expect(speechErrorCode(error)).toBe('http:403')
  })

  it('音频体积超限抛 oversize（声明长度与实际字节都检查）', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('multimodal-generation')) {
        return jsonResponse({ output: { audio: { url: 'https://download.example.com/tts/e.wav' } } })
      }
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-type': 'audio/wav', 'content-length': String(MAX_TTS_AUDIO_BYTES + 1) }
      })
    }))
    const declared = await synthesizeSpeech(speechOptions, { text: '第一片。' }).catch(item => item)
    expect(speechErrorCode(declared)).toBe('oversize')

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('multimodal-generation')) {
        return jsonResponse({ output: { audio: { url: 'https://download.example.com/tts/f.wav' } } })
      }
      return new Response(new Uint8Array(MAX_TTS_AUDIO_BYTES + 1), { status: 200, headers: { 'content-type': 'audio/wav' } })
    }))
    const actual = await synthesizeSpeech(speechOptions, { text: '第一片。' }).catch(item => item)
    expect(speechErrorCode(actual)).toBe('oversize')
  })

  it('合成响应缺少 output.audio.url 抛 schema 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ output: { audio: {} } })))
    const missingUrl = await synthesizeSpeech(speechOptions, { text: '第一片。' }).catch(item => item)
    expect(speechErrorCode(missingUrl)).toBe('schema')
  })
})
