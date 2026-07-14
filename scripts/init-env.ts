import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const target = '.env'
const template = '.env.example'
if (!existsSync(template)) throw new Error('.env.example is missing')

let source = existsSync(target) ? readFileSync(target, 'utf8') : readFileSync(template, 'utf8')
if (!source.includes('replace-with')) {
  const templateSource = readFileSync(template, 'utf8')
  const existingKeys = new Set([...source.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(match => match[1]))
  const missingLines = templateSource.split('\n').filter(line => {
    const key = line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1]
    return Boolean(key && !existingKeys.has(key))
  })
  if (missingLines.length) {
    source = `${source.trimEnd()}\n${missingLines.join('\n')}\n`
    writeFileSync(target, source, { mode: 0o600 })
    chmodSync(target, 0o600)
    process.stdout.write(`.env is initialized; added ${missingLines.length} newly supported settings\n`)
  } else {
    process.stdout.write('.env is already initialized; no changes made\n')
  }
} else {
  const get = (key: string) => source.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1] || ''
  const set = (key: string, value: string) => {
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    source = pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`
  }
  const secret = () => randomBytes(32).toString('hex')
  const replacePlaceholder = (key: string) => {
    const current = get(key)
    const value = !current || current.includes('replace-with') ? secret() : current
    set(key, value)
    return value
  }

  const adminPassword = replacePlaceholder('POSTGRES_PASSWORD')
  const appPassword = replacePlaceholder('APP_DB_PASSWORD')
  replacePlaceholder('SESSION_SECRET')
  replacePlaceholder('ENCRYPTION_KEY')

  const adminUser = get('POSTGRES_USER') || 'mentor_admin'
  const appUser = get('APP_DB_USER') || 'mentor_app'
  const database = get('POSTGRES_DB') || 'mentor_ai'
  set('DATABASE_URL', `postgres://${appUser}:${encodeURIComponent(appPassword)}@localhost:5432/${database}`)
  set('MIGRATION_DATABASE_URL', `postgres://${adminUser}:${encodeURIComponent(adminPassword)}@localhost:5432/${database}`)
  if (get('SERVER_NAME') === 'mentor.example.edu.cn') set('SERVER_NAME', 'localhost')

  writeFileSync(target, source, { mode: 0o600 })
  chmodSync(target, 0o600)
  process.stdout.write('.env initialized with random local secrets (values were not printed)\n')
}
