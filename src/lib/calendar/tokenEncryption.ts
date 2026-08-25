import crypto from 'node:crypto'

const tokenPrefix = 'enc:v1'
const tokenSalt = 'manoa-calendar-token-salt-v1'

function tokenKey() {
  const secret = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY?.trim()
  if (!secret) {
    throw new Error('Missing required environment variable: CALENDAR_TOKEN_ENCRYPTION_KEY')
  }
  return crypto.scryptSync(secret, tokenSalt, 32)
}

export function encryptCalendarToken(value: string | null | undefined) {
  if (!value) return null
  if (value.startsWith(`${tokenPrefix}:`)) return value

  const key = tokenKey()

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    tokenPrefix,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

export function decryptCalendarToken(value: string | null | undefined) {
  if (!value) return null
  if (!value.startsWith(`${tokenPrefix}:`)) return value

  const key = tokenKey()

  const encodedPayload = value.slice(`${tokenPrefix}:`.length)
  const [ivPart, tagPart, ...dataParts] = encodedPayload.split(':')
  const dataPart = dataParts.join(':')
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Stored calendar token is malformed.')
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivPart, 'base64url'),
    { authTagLength: 16 },
  )
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}
