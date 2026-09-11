import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  devtools: { enabled: true },
  devServer: { host: '0.0.0.0', port: 3301 },
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
    deepseekRouterModel: process.env.DEEPSEEK_ROUTER_MODEL || 'deepseek-v4-flash',
    deepseekGeneratorModel: process.env.DEEPSEEK_GENERATOR_MODEL || 'deepseek-v4-pro',
    // 完整上下文只有登记供应商协议版本后才允许启用。
    deepseekAgreementVersion: process.env.DEEPSEEK_AGREEMENT_VERSION || '',
    deepseekTimeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || 30000),
    embeddingEnabled: process.env.EMBEDDING_ENABLED === 'true',
    // ollama | dashscope：向量化供应商，切换后存量向量需全量重建（语义空间不兼容）
    embeddingProvider: process.env.EMBEDDING_PROVIDER || 'ollama',
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
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
  }
})
