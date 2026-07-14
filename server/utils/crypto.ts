import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto'

function keyFromSecret(secret: string) {
  return scryptSync(secret, 'mentor-ai-v1', 32)
}

export function encryptSensitive(value: string, secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptSensitive(value: string | null, secret: string) {
  if (!value) return ''
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('Invalid encrypted value')
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
}

export function searchableHash(value: string, secret: string) {
  return createHmac('sha256', keyFromSecret(secret)).update(value.trim().toLowerCase()).digest('hex')
}

export function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
