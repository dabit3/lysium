import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import process from 'node:process'

const ENV_FILES = ['.env.local', '.env']

const loadEnvFiles = () => {
  const root = process.cwd()

  ENV_FILES.forEach((fileName) => {
    const filePath = resolve(root, fileName)
    if (!existsSync(filePath)) {
      return
    }

    const raw = readFileSync(filePath, 'utf8')
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .forEach((line) => {
        if (!line || line.startsWith('#')) {
          return
        }

        const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
        const separatorIndex = normalized.indexOf('=')
        if (separatorIndex <= 0) {
          return
        }

        const key = normalized.slice(0, separatorIndex).trim()
        const value = normalized.slice(separatorIndex + 1).trim()
        if (!key || process.env[key] !== undefined) {
          return
        }

        const unwrapped = value.replace(/^(["'])(.*)\1$/, '$2')
        process.env[key] = unwrapped
      })
  })
}

loadEnvFiles()

const readEnv = (key, fallback = '') => {
  const value = process.env[key]
  return typeof value === 'string' ? value.trim() : fallback
}

const readNumberEnv = (key, fallback) => {
  const value = Number(readEnv(key, ''))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const readBooleanEnv = (key, fallback = false) => {
  const value = readEnv(key, '')
  if (!value) {
    return fallback
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

const PORT = readNumberEnv('GITHUB_OAUTH_SERVER_PORT', 8787)
const CLIENT_ID = readEnv('GITHUB_OAUTH_CLIENT_ID')
const CLIENT_SECRET = readEnv('GITHUB_OAUTH_CLIENT_SECRET')
const REDIRECT_URI = readEnv('GITHUB_OAUTH_REDIRECT_URI')
const OAUTH_SCOPE = 'repo'
const SUCCESS_REDIRECT_URL = readEnv('GITHUB_OAUTH_SUCCESS_REDIRECT_URL', 'http://localhost:5173/')
const ALLOWED_ORIGIN = readEnv('GITHUB_OAUTH_ALLOWED_ORIGIN', 'http://localhost:5173')
const COOKIE_DOMAIN = readEnv('GITHUB_OAUTH_COOKIE_DOMAIN')
const COOKIE_SECURE = readBooleanEnv('GITHUB_OAUTH_COOKIE_SECURE', false)
const STATE_TTL_SECONDS = readNumberEnv('GITHUB_OAUTH_STATE_TTL_SECONDS', 600)
const SESSION_TTL_SECONDS = readNumberEnv('GITHUB_OAUTH_SESSION_TTL_SECONDS', 43200)

const STATE_COOKIE_NAME = 'elysium_gh_oauth_state'
const SESSION_COOKIE_NAME = 'elysium_gh_oauth_session'

const oauthSessions = new Map()

const parseCookies = (cookieHeader) => {
  if (!cookieHeader) {
    return {}
  }

  return cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .reduce((accumulator, entry) => {
      const separatorIndex = entry.indexOf('=')
      if (separatorIndex <= 0) {
        return accumulator
      }

      const key = decodeURIComponent(entry.slice(0, separatorIndex).trim())
      const value = decodeURIComponent(entry.slice(separatorIndex + 1).trim())
      if (!key) {
        return accumulator
      }

      accumulator[key] = value
      return accumulator
    }, {})
}

const buildCookie = (name, value, options = {}) => {
  const {
    maxAge,
    path = '/',
    httpOnly = true,
    sameSite = 'Lax',
    secure = COOKIE_SECURE,
    domain,
  } = options

  const segments = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`]

  if (Number.isFinite(maxAge)) {
    segments.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`)
  }

  if (httpOnly) {
    segments.push('HttpOnly')
  }

  if (secure) {
    segments.push('Secure')
  }

  if (domain && domain.length > 0) {
    segments.push(`Domain=${domain}`)
  }

  return segments.join('; ')
}

const appendSetCookie = (response, cookieValue) => {
  const existing = response.getHeader('Set-Cookie')
  if (!existing) {
    response.setHeader('Set-Cookie', [cookieValue])
    return
  }

  if (Array.isArray(existing)) {
    response.setHeader('Set-Cookie', [...existing, cookieValue])
    return
  }

  response.setHeader('Set-Cookie', [String(existing), cookieValue])
}

const applyCors = (request, response) => {
  const origin = request.headers.origin
  if (!origin) {
    return
  }

  if (!ALLOWED_ORIGIN || origin !== ALLOWED_ORIGIN) {
    return
  }

  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Credentials', 'true')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Vary', 'Origin')
}

const sendJson = (response, statusCode, payload) => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

const redirect = (response, location) => {
  response.statusCode = 302
  response.setHeader('Location', location)
  response.end()
}

const clearCookie = (response, cookieName) => {
  appendSetCookie(
    response,
    buildCookie(cookieName, '', {
      maxAge: 0,
      domain: COOKIE_DOMAIN || undefined,
    }),
  )
}

const createRedirectUrl = (options = {}) => {
  const url = new URL(SUCCESS_REDIRECT_URL)

  if (options.error) {
    url.searchParams.set('github_oauth_error', options.error)
  }

  return url.toString()
}

const isOauthConfigured = () =>
  CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0 && REDIRECT_URI.length > 0

const exchangeOauthCode = async (code, state) => {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'elysium-github-oauth-server',
    },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      state,
      redirect_uri: REDIRECT_URI,
    }),
  })

  const payload = (await response.json())

  if (!response.ok || typeof payload !== 'object' || payload === null) {
    throw new Error('GitHub token exchange failed.')
  }

  if (typeof payload.error === 'string') {
    throw new Error(payload.error_description || payload.error)
  }

  if (typeof payload.access_token !== 'string' || payload.access_token.trim().length === 0) {
    throw new Error('GitHub token exchange returned no access token.')
  }

  return payload.access_token.trim()
}

const fetchGithubLogin = async (accessToken) => {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'elysium-github-oauth-server',
    },
  })

  if (!response.ok) {
    return null
  }

  const payload = (await response.json())
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const candidate = payload
  return typeof candidate.login === 'string' && candidate.login.trim().length > 0
    ? candidate.login.trim()
    : null
}

const pruneExpiredSessions = () => {
  const now = Date.now()
  for (const [sessionId, session] of oauthSessions.entries()) {
    if (now >= session.expiresAt) {
      oauthSessions.delete(sessionId)
    }
  }
}

const createSession = (accessToken, login) => {
  pruneExpiredSessions()
  const sessionId = randomBytes(32).toString('hex')
  oauthSessions.set(sessionId, {
    accessToken,
    login,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  })
  return sessionId
}

const getSessionFromRequest = (request) => {
  pruneExpiredSessions()
  const cookies = parseCookies(request.headers.cookie)
  const sessionId = cookies[SESSION_COOKIE_NAME]
  if (!sessionId) {
    return null
  }

  const session = oauthSessions.get(sessionId)
  if (!session) {
    return null
  }

  if (Date.now() >= session.expiresAt) {
    oauthSessions.delete(sessionId)
    return null
  }

  return {
    sessionId,
    ...session,
  }
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
  const pathname = url.pathname
  const method = request.method || 'GET'

  if (pathname === '/api/github/oauth/token' || pathname === '/api/github/oauth/disconnect') {
    applyCors(request, response)
  }

  if (method === 'OPTIONS') {
    response.statusCode = 204
    response.end()
    return
  }

  if (pathname === '/api/github/oauth/start' && method === 'GET') {
    if (!isOauthConfigured()) {
      sendJson(response, 500, {
        error: 'GitHub OAuth backend is not configured. Set client id/secret/redirect URI.',
      })
      return
    }

    const state = randomBytes(20).toString('hex')
    const authorizeUrl = new URL('https://github.com/login/oauth/authorize')
    authorizeUrl.searchParams.set('client_id', CLIENT_ID)
    authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI)
    authorizeUrl.searchParams.set('scope', OAUTH_SCOPE)
    authorizeUrl.searchParams.set('state', state)

    appendSetCookie(
      response,
      buildCookie(STATE_COOKIE_NAME, state, {
        maxAge: STATE_TTL_SECONDS,
        domain: COOKIE_DOMAIN || undefined,
      }),
    )

    redirect(response, authorizeUrl.toString())
    return
  }

  if (pathname === '/api/github/oauth/callback' && method === 'GET') {
    const oauthError = url.searchParams.get('error')
    if (oauthError) {
      clearCookie(response, STATE_COOKIE_NAME)
      redirect(response, createRedirectUrl({ error: oauthError }))
      return
    }

    if (!isOauthConfigured()) {
      clearCookie(response, STATE_COOKIE_NAME)
      redirect(response, createRedirectUrl({ error: 'oauth_not_configured' }))
      return
    }

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const cookies = parseCookies(request.headers.cookie)
    const expectedState = cookies[STATE_COOKIE_NAME]

    if (!code || !state || !expectedState || state !== expectedState) {
      clearCookie(response, STATE_COOKIE_NAME)
      redirect(response, createRedirectUrl({ error: 'invalid_oauth_state' }))
      return
    }

    try {
      const accessToken = await exchangeOauthCode(code, state)
      const login = await fetchGithubLogin(accessToken)
      const sessionId = createSession(accessToken, login)

      clearCookie(response, STATE_COOKIE_NAME)
      appendSetCookie(
        response,
        buildCookie(SESSION_COOKIE_NAME, sessionId, {
          maxAge: SESSION_TTL_SECONDS,
          domain: COOKIE_DOMAIN || undefined,
        }),
      )

      redirect(response, createRedirectUrl())
      return
    } catch (error) {
      clearCookie(response, STATE_COOKIE_NAME)
      const message = error instanceof Error ? error.message : 'oauth_exchange_failed'
      redirect(response, createRedirectUrl({ error: message }))
      return
    }
  }

  if (pathname === '/api/github/oauth/token' && method === 'GET') {
    const session = getSessionFromRequest(request)

    if (!session) {
      clearCookie(response, SESSION_COOKIE_NAME)
      sendJson(response, 401, { error: 'No active GitHub OAuth session.' })
      return
    }

    sendJson(response, 200, {
      access_token: session.accessToken,
      login: session.login ?? undefined,
    })
    return
  }

  if (pathname === '/api/github/oauth/disconnect' && method === 'POST') {
    const cookies = parseCookies(request.headers.cookie)
    const sessionId = cookies[SESSION_COOKIE_NAME]
    if (sessionId) {
      oauthSessions.delete(sessionId)
    }

    clearCookie(response, SESSION_COOKIE_NAME)
    response.statusCode = 204
    response.end()
    return
  }

  if (pathname === '/api/github/oauth/health' && method === 'GET') {
    sendJson(response, 200, {
      ok: true,
      oauthConfigured: isOauthConfigured(),
      activeSessionCount: oauthSessions.size,
    })
    return
  }

  sendJson(response, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  const baseUrl = `http://localhost:${PORT}`
  process.stdout.write(`GitHub OAuth backend listening on ${baseUrl}\n`)
})
