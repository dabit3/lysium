import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

const MIN_SECRET_LENGTH = 32

const secret = () => {
  const s = process.env.GITHUB_OAUTH_COOKIE_SECRET
  if (!s || s.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `GITHUB_OAUTH_COOKIE_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters`,
    )
  }
  return s
}

const secure = () => {
  const v = (process.env.GITHUB_OAUTH_COOKIE_SECURE ?? '').toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(v)
}

// Derive separate 256-bit keys for encryption and signing
const encryptionKey = () =>
  createHash('sha256').update(`${secret()}:encrypt`).digest()
const signingKey = () =>
  createHash('sha256').update(`${secret()}:sign`).digest()

const encrypt = (plaintext) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  // Format: iv (12) + authTag (16) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url')
}

const decrypt = (encoded) => {
  const buf = Buffer.from(encoded, 'base64url')
  if (buf.length < 28) return null // 12 (iv) + 16 (tag) minimum
  const iv = buf.subarray(0, 12)
  const authTag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  )
}

export const sign = (value) => {
  const hmac = createHmac('sha256', signingKey())
  hmac.update(value)
  return hmac.digest('hex')
}

export const buildSignedValue = (payload) => {
  const encrypted = encrypt(JSON.stringify(payload))
  return `${encrypted}.${sign(encrypted)}`
}

export const parseSignedValue = (raw) => {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot < 0) return null
  const data = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  try {
    if (
      !timingSafeEqual(
        Buffer.from(sig, 'hex'),
        Buffer.from(sign(data), 'hex'),
      )
    )
      return null
  } catch {
    return null
  }
  try {
    return JSON.parse(decrypt(data))
  } catch {
    return null
  }
}

export const parseCookies = (header) => {
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').flatMap((part) => {
      const idx = part.indexOf('=')
      if (idx <= 0) return []
      const k = decodeURIComponent(part.slice(0, idx).trim())
      const v = decodeURIComponent(part.slice(idx + 1).trim())
      return k ? [[k, v]] : []
    }),
  )
}

export const buildCookie = (name, value, maxAge) => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    'HttpOnly',
  ]
  if (secure()) parts.push('Secure')
  const domain = process.env.GITHUB_OAUTH_COOKIE_DOMAIN ?? ''
  if (domain) parts.push(`Domain=${domain}`)
  return parts.join('; ')
}

export const clearCookie = (name) => buildCookie(name, '', 0)
