import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  devtools: { enabled: true },
  // 本地开发端口 3305：与正式（3300 HTTP / 443 HTTPS）、测试（3400 / 3401）以及 Playwright（3100）都错开
  devServer: { host: '0.0.0.0', port: 3305 },
  modules: [['@nuxt/ui', { fonts: false }]],
  ui: { fonts: false },
  // 强制浅色：项目未实现夜间主题样式，跟随系统会在暗色系统下出现组件暗、页面浅的混搭。
  // storageKey 换新键：旧键残留的 'system' 会覆盖 preference，导致存量浏览器仍然跟随系统。
  colorMode: { preference: 'light', fallback: 'light', storageKey: 'mentor-ai-color-mode' },
  // 目录名不参与组件名：management/TableToolbar.vue 直接以 <TableToolbar> 使用。
  components: [{ path: '~/components', pathPrefix: false }],
  css: ['~/assets/css/main.css'],
  nitro: {
    preset: 'node-server',
    experimental: { tasks: true },
    // 全局错误处理：ZodError → 400（精简 message，不泄露 stack），其余走内置默认处理器。
    // 注意不能用 `~/` 前缀：Nuxt 4 中 nitro srcDir 是 app/，`~` 会解析到 app 目录。
    errorHandler: fileURLToPath(new URL('./server/error-handler.ts', import.meta.url))
  },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || 'postgres://mentor:mentor@localhost:5432/mentor_ai',
    sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me',
    encryptionKey: process.env.ENCRYPTION_KEY || 'development-encryption-key-change-me',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    deepseekRouterModel: process.env.DEEPSEEK_ROUTER_MODEL || 'deepseek-flash',
    deepseekGeneratorModel: process.env.DEEPSEEK_GENERATOR_MODEL || 'deepseek-flash',
    // 完整上下文只有登记供应商协议版本后才允许启用。
    deepseekAgreementVersion: process.env.DEEPSEEK_AGREEMENT_VERSION || '',
    deepseekTimeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || 30000),
    // Agent 对话记忆（P1）：历史 token 预算 / 单轮输出上限 / 压缩触发比例
    agentHistoryTokenBudget: Number(process.env.AI_AGENT_HISTORY_TOKEN_BUDGET || 24000),
    agentMaxOutputTokens: Number(process.env.AI_AGENT_MAX_OUTPUT_TOKENS || 4096),
    agentCompactionKeepRatio: Number(process.env.AI_AGENT_COMPACTION_KEEP_RATIO || 0.5),
    // Agent 工具治理：单轮工具轮次上限、启用的工具名清单（逗号分隔；空 = 按上下文裁剪后全部启用）
    agentMaxToolRounds: Number(process.env.AI_AGENT_MAX_TOOL_ROUNDS || 8),
    agentEnabledTools: process.env.AI_AGENT_ENABLED_TOOLS || '',
    // strict tool calling 试点（DeepSeek Beta）：逗号分隔的 purpose 列表；
    // 空 = 全部走 json_object（与既有行为一致），启用后 strict 不可用会自动回退
    aiStrictJsonPurposes: process.env.AI_STRICT_JSON_PURPOSES || '',
    embeddingEnabled: process.env.EMBEDDING_ENABLED === 'true',
    // 学段过滤开关（三库资源与知识库文档的「适用学部」）：默认关闭，所有请求都不过滤；
    // 内容按学段细分好后，设 NUXT_SCHOOL_SECTION_FILTER_ENABLED=true 即可启用（见 server/utils/stage-filter.ts）
    schoolSectionFilterEnabled: process.env.SCHOOL_SECTION_FILTER_ENABLED === 'true',
    // ollama | dashscope：向量化供应商，切换后存量向量需全量重建（语义空间不兼容）
    embeddingProvider: process.env.EMBEDDING_PROVIDER || 'ollama',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
    // 原生 DashScope 端点（与上面的 compatible-mode 不同）：语音合成 qwen3-tts-flash 用
    dashscopeApiBaseUrl: process.env.DASHSCOPE_API_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
    // 语音输入与回答朗读：总开关关闭、缺 DASHSCOPE_API_KEY 或学校数据模式为 local 时整体不可用
    speechEnabled: process.env.SPEECH_ENABLED !== 'false',
    // 识别与朗读都按「模型系列 → 端点/请求体」自动选择，见 server/integrations/dashscope-speech.ts：
    // qwen-audio-* 与 qwen3-* 的端点、入参与返回结构都不同，换模型只改环境变量即可
    asrModel: process.env.ASR_MODEL || 'qwen-audio-3.0-asr-flash',
    ttsModel: process.env.TTS_MODEL || 'qwen-audio-3.0-tts-flash',
    ttsVoice: process.env.TTS_VOICE || 'longanlingxi',
    embeddingModel: process.env.EMBEDDING_MODEL || 'qwen3-embedding:0.6b',
    embeddingTimeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS || 8000),
    smsProvider: process.env.SMS_PROVIDER || 'mock',
    smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
    oidcIssuer: process.env.OIDC_ISSUER || '',
    oidcClientId: process.env.OIDC_CLIENT_ID || '',
    oidcClientSecret: process.env.OIDC_CLIENT_SECRET || '',
    oidcRedirectUri: process.env.OIDC_REDIRECT_URI || '',
    public: {
      appName: '教师赋能智能平台',
      // 统一身份登录入口：显式开启，或构建时 OIDC 四项齐全（docker 部署由 compose 按 OIDC_ISSUER 联动注入）
      showSsoLogin: process.env.NUXT_PUBLIC_SHOW_SSO_LOGIN === 'true' ||
        !!(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_CLIENT_SECRET && process.env.OIDC_REDIRECT_URI)
    }
  },
  routeRules: {
    '/school-admin/**': { headers: { 'cache-control': 'no-store, private' } },
    '/platform-admin/**': { headers: { 'cache-control': 'no-store, private' } },
    '/specialist/**': { headers: { 'cache-control': 'no-store, private' } },
    '/information/**': { headers: { 'cache-control': 'no-store, private' } }
  },
  typescript: {
    strict: true,
    typeCheck: true
  },
  app: {
    head: {
      meta: [
        // resizes-content：Android 上键盘直接压缩布局视口，100dvh 同步收缩，输入框自然停在键盘上方；
        // 同时避免浏览器为露出输入框平移可视视口，把 fixed 的底部菜单拖到键盘上方。iOS 不支持该声明，
        // 由 useKeyboardInset 用可视视口差值补偿；底部菜单在键盘弹出时统一隐藏。
        { name: 'viewport', content: 'width=device-width, initial-scale=1, interactive-widget=resizes-content' }
      ]
    }
  }
})
