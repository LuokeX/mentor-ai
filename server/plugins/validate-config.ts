export default defineNitroPlugin(() => {
  if (process.env.NODE_ENV !== 'production') return
  const config = useRuntimeConfig()
  const invalid = [
    ['NUXT_DATABASE_URL', config.databaseUrl, 'postgres://mentor:mentor@localhost:5432/mentor_ai'],
    ['NUXT_SESSION_SECRET', config.sessionSecret, 'development-only-change-me'],
    ['NUXT_ENCRYPTION_KEY', config.encryptionKey, 'development-encryption-key-change-me']
  ].filter(([, value, developmentValue]) => {
    const text = String(value || '')
    return !text || text === developmentValue || text.includes('replace-with') || text.length < 32
  })
  if (invalid.length) {
    throw new Error(`Production configuration is unsafe or missing: ${invalid.map(([name]) => name).join(', ')}`)
  }
})
