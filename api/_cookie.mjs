import { createHmac, timingSafeEqual } from 'node:crypto'

const secret = () => process.env.GITHUB_OAUTH_COOKIE_SECRET ?? ''
const secure = () => {
  const v = (process.env.GITHUB_OAUTH_COOKIE_SECURE ?? '').toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(v)
}

export const sign = (value) => {
  const hmac = createHmac('sha256', secret())
  hmac.update(value)
  return hmac.digest('hex')
}

export const buildSignedValue = (payload) => {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${b64}.${sign(b64)}`
}

export const parseSignedValue = (raw) => {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot < 0) return null
  const b64 = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(sign(b64), 'hex'))) return null
  } catch {
    return null
  }
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
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
