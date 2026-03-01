import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto'

const readEnv = (key, fallback = '') => {
  const value = process.env[key]
  return typeof value === 'string' ? value.trim() : fallback
}

const readBooleanEnv = (key, fallback = false) => {
  const value = readEnv(key, '')
  if (!value) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

const CLIENT_ID = readEnv('GITHUB_OAUTH_CLIENT_ID')
const CLIENT_SECRET = readEnv('GITHUB_OAUTH_CLIENT_SECRET')
const REDIRECT_URI = readEnv('GITHUB_OAUTH_REDIRECT_URI')
const SCOPES = readEnv('GITHUB_OAUTH_SCOPES', 'repo')
const SUCCESS_REDIRECT_URL = readEnv('GITHUB_OAUTH_SUCCESS_REDIRECT_URL')
const ALLOWED_ORIGIN = readEnv('GITHUB_OAUTH_ALLOWED_ORIGIN')
const COOKIE_DOMAIN = readEnv('GITHUB_OAUTH_COOKIE_DOMAIN')
const COOKIE_SECRET = readEnv('GITHUB_OAUTH_COOKIE_SECRET')
const COOKIE_SECURE = readBooleanEnv('GITHUB_OAUTH_COOKIE_SECURE', true)
const SESSION_TTL_SECONDS = 43200
const STATE_TTL_SECONDS = 600

const STATE_COOKIE_NAME = 'elysium_gh_oauth_state'
const SESSION_COOKIE_NAME = 'elysium_gh_oauth_session'

const isConfigured = () => CLIENT_ID && CLIENT_SECRET && REDIRECT_URI && COOKIE_SECRET

const sign = (value) => {
  const hmac = createHmac('sha256', COOKIE_SECRET)
  hmac.update(value)
  return hmac.digest('hex')
}

const buildSignedCookieValue = (payload) => {
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json).toString('base64url')
  const sig = sign(b64)
  return `${b64}.${sig}`
}

const parseSignedCookieValue = (raw) => {
  if (!raw) return null
  const dotIndex = raw.lastIndexOf('.')
  if (dotIndex < 0) return null
  const b64 = raw.slice(0, dotIndex)
  const sig = raw.slice(dotIndex + 1)
  const expectedSig = sign(b64)
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) return null
  } catch {
    return null
  }
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

const parseCookies = (header) => {
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

const buildCookie = (name, value, maxAge, extra = {}) => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    'HttpOnly',
  ]
  if (COOKIE_SECURE) parts.push('Secure')
  if (COOKIE_DOMAIN) parts.push(`Domain=${COOKIE_DOMAIN}`)
  return parts.join('; ')
}

const clearCookie = (name) => buildCookie(name, '', 0)

const successUrl = (error) => {
  const base = SUCCESS_REDIRECT_URL || 'https://your-app.vercel.app/'
  const url = new URL(base)
  if (error) url.searchParams.set('github_oauth_error', error)
  return url.toString()
}

const exchangeCode = async (code, state) => {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'elysium-github-oauth-server' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, state, redirect_uri: REDIRECT_URI }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error_description || data.error)
  if (!data.access_token) throw new Error('No access token returned')
  return data.access_token.trim()
}

const fetchLogin = async (token) => {
  const res = await fetch('https://api.github.com/user', {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'elysium-github-oauth-server' },
  })
  if (!res.ok) return null
  const data = await res.json()
  return typeof data?.login === 'string' ? data.login.trim() : null
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`)
  const route = url.pathname.replace(/^\/api\/github\/oauth\/?/, '') || ''
  const method = req.method

  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Vary', 'Origin')
  }

  if (method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (route === 'start' && method === 'GET') {
    if (!isConfigured()) {
      res.status(500).json({ error: 'OAuth not configured on server.' })
      return
    }
    const state = randomBytes(20).toString('hex')
    const authUrl = new URL('https://github.com/login/oauth/authorize')
    authUrl.searchParams.set('client_id', CLIENT_ID)
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('state', state)

    res.setHeader('Set-Cookie', buildCookie(STATE_COOKIE_NAME, state, STATE_TTL_SECONDS))
    res.redirect(302, authUrl.toString())
    return
  }

  if (route === 'callback' && method === 'GET') {
    const oauthError = url.searchParams.get('error')
    if (oauthError) {
      res.setHeader('Set-Cookie', clearCookie(STATE_COOKIE_NAME))
      res.redirect(302, successUrl(oauthError))
      return
    }
    if (!isConfigured()) {
      res.setHeader('Set-Cookie', clearCookie(STATE_COOKIE_NAME))
      res.redirect(302, successUrl('oauth_not_configured'))
      return
    }

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const cookies = parseCookies(req.headers.cookie)
    const expectedState = cookies[STATE_COOKIE_NAME]

    if (!code || !state || !expectedState || state !== expectedState) {
      res.setHeader('Set-Cookie', clearCookie(STATE_COOKIE_NAME))
      res.redirect(302, successUrl('invalid_oauth_state'))
      return
    }

    try {
      const accessToken = await exchangeCode(code, state)
      const login = await fetchLogin(accessToken)
      const payload = { accessToken, login, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }
      const sessionValue = buildSignedCookieValue(payload)

      res.setHeader('Set-Cookie', [
        clearCookie(STATE_COOKIE_NAME),
        buildCookie(SESSION_COOKIE_NAME, sessionValue, SESSION_TTL_SECONDS),
      ])
      res.redirect(302, successUrl())
    } catch (err) {
      res.setHeader('Set-Cookie', clearCookie(STATE_COOKIE_NAME))
      res.redirect(302, successUrl(err instanceof Error ? err.message : 'oauth_exchange_failed'))
    }
    return
  }

  if (route === 'token' && method === 'GET') {
    const cookies = parseCookies(req.headers.cookie)
    const raw = cookies[SESSION_COOKIE_NAME]
    const payload = parseSignedCookieValue(raw)

    if (!payload || Math.floor(Date.now() / 1000) > payload.exp) {
      res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE_NAME))
      res.status(401).json({ error: 'No active GitHub OAuth session.' })
      return
    }

    res.status(200).json({ access_token: payload.accessToken, login: payload.login ?? undefined })
    return
  }

  if (route === 'disconnect' && method === 'POST') {
    res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE_NAME))
    res.status(204).end()
    return
  }

  if (route === 'health' && method === 'GET') {
    res.status(200).json({ ok: true, oauthConfigured: isConfigured() })
    return
  }

  res.status(404).json({ error: 'Not found' })
}
