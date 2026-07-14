export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  devtools: { enabled: true },
  modules: [['@nuxt/ui', { fonts: false }]],
  ui: { fonts: false },
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
    deepseekTimeoutMs: Number(process.env.DEEPSEEK_TIMEOUT_MS || 8000),
    smsProvider: process.env.SMS_PROVIDER || 'mock',
    smsWebhookUrl: process.env.SMS_WEBHOOK_URL || '',
    public: {
      appName: '教师赋能智能平台'
    }
  },
  routeRules: {
    '/school-admin/**': { headers: { 'cache-control': 'no-store, private' } },
    '/platform-admin/**': { headers: { 'cache-control': 'no-store, private' } },
    '/specialist/**': { headers: { 'cache-control': 'no-store, private' } }
  },
  typescript: {
    strict: true,
    typeCheck: true
  }
})
