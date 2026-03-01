import { randomBytes } from 'node:crypto'
import {
  buildSignedValue,
  parseSignedValue,
  parseCookies,
  buildCookie,
  clearCookie,
} from '../../_cookie.mjs'

const readEnv = (key, fallback = '') => {
  const value = process.env[key]
  return typeof value === 'string' ? value.trim() : fallback
}

const SESSION_TTL_SECONDS = 43200
const STATE_TTL_SECONDS = 600

const STATE_COOKIE_NAME = 'elysium_gh_oauth_state'
const SESSION_COOKIE_NAME = 'elysium_gh_oauth_session'

// Read config lazily at request time so env vars loaded after module import work
const cfg = () => ({
  clientId: readEnv('GITHUB_OAUTH_CLIENT_ID'),
  clientSecret: readEnv('GITHUB_OAUTH_CLIENT_SECRET'),
  redirectUri: readEnv('GITHUB_OAUTH_REDIRECT_URI'),
  successRedirectUrl: readEnv('GITHUB_OAUTH_SUCCESS_REDIRECT_URL'),
  allowedOrigin: readEnv('GITHUB_OAUTH_ALLOWED_ORIGIN'),
})

const isConfigured = () => {
  const { clientId, clientSecret, redirectUri } = cfg()
  return clientId && clientSecret && redirectUri && process.env.GITHUB_OAUTH_COOKIE_SECRET
}

const successUrl = (error) => {
  const base = cfg().successRedirectUrl || 'https://your-app.vercel.app/'
  const url = new URL(base)
  if (error) url.searchParams.set('github_oauth_error', error)
  return url.toString()
}

const exchangeCode = async (code, state) => {
  const { clientId, clientSecret, redirectUri } = cfg()
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'elysium-github-oauth-server' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, state, redirect_uri: redirectUri }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error_description || data.error)
  if (!data.access_token) throw new Error('No access token returned')
  return data.access_token.trim()
}

const fetchUserInfo = async (token) => {
  const res = await fetch('https://api.github.com/user', {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'elysium-github-oauth-server' },
  })
  if (!res.ok) return { login: null, userId: null }
  const data = await res.json()
  return {
    login: typeof data?.login === 'string' ? data.login.trim() : null,
    userId: typeof data?.id === 'number' ? data.id : null,
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`)
  const route = url.pathname.replace(/^\/api\/github\/oauth\/?/, '') || ''
  const method = req.method
  const { allowedOrigin, redirectUri } = cfg()

  const origin = req.headers.origin
  if (origin && allowedOrigin && origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Vary', 'Origin')
  }

  if (method === 'OPTIONS') { res.status(204).end(); return }

  if (route === 'start' && method === 'GET') {
    if (!isConfigured()) { res.status(500).json({ error: 'OAuth not configured on server.' }); return }
    const { clientId } = cfg()
    const state = randomBytes(20).toString('hex')
    const authUrl = new URL('https://github.com/login/oauth/authorize')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', 'repo')
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
      const { login, userId } = await fetchUserInfo(accessToken)
      const payload = { accessToken, login, userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }
      res.setHeader('Set-Cookie', [
        clearCookie(STATE_COOKIE_NAME),
        buildCookie(SESSION_COOKIE_NAME, buildSignedValue(payload), SESSION_TTL_SECONDS),
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
    const payload = parseSignedValue(cookies[SESSION_COOKIE_NAME])
    if (!payload || Math.floor(Date.now() / 1000) > payload.exp) {
      res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE_NAME))
      res.status(401).json({ error: 'No active GitHub OAuth session.' })
      return
    }
    res.status(200).json({ access_token: payload.accessToken, login: payload.login ?? undefined, userId: payload.userId ?? undefined })
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
