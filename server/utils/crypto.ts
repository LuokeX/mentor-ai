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

/**
 * 批量解密记录中的敏感字段，自动清理加密列。
 *
 * 使用方式：
 *   const cleaned = decryptFields(row, { nameEnc: 'name', phoneEnc: 'phone' }, secret)
 *
 * 结果中 nameEnc / phoneEnc 会被删除，替换为 name / phone 明文。
 */
export function decryptFields<T extends Record<string, unknown>>(
  record: T,
  fieldMap: Record<string, string>,
  secret: string
): T {
  const result = { ...record }
  for (const [encField, plainField] of Object.entries(fieldMap)) {
    const encrypted = result[encField]
    if (typeof encrypted === 'string') {
      ;(result as Record<string, unknown>)[plainField] = decryptSensitive(encrypted, secret)
      delete (result as Record<string, unknown>)[encField]
    }
  }
  return result
}
