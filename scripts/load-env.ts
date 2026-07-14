import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'

/** Load local CLI configuration without overriding variables supplied by Docker/CI. */
export function loadLocalEnv() {
  const envFile = process.env.ENV_FILE || '.env'
  if (existsSync(envFile)) loadEnvFile(envFile)
}
