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
    experimental: { tasks: true }
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
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    embeddingModel: process.env.EMBEDDING_MODEL || 'qwen3-embedding:0.6b',
    embeddingTimeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS || 8000),
    smsProvider: process.env.SMS_PROVIDER || 'mock',
    smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
    public: {
      appName: '教师赋能智能平台',
      showDemoLogin: process.env.NUXT_PUBLIC_SHOW_DEMO_LOGIN === 'true' || process.env.NODE_ENV !== 'production'
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
