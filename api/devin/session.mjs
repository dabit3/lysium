import {
  buildSignedValue,
  parseSignedValue,
  parseCookies,
  buildCookie,
  clearCookie,
} from '../_cookie.mjs'
import { checkRateLimit } from '../_rate-limit.mjs'

const SESSION_COOKIE_NAME = 'elysium_devin_session'
const SESSION_TTL_SECONDS = 43200 // 12 hours
const MAX_BODY_BYTES = 10 * 1024 // 10 KB

const getSession = (req) => {
  const cookies = parseCookies(req.headers.cookie)
  const payload = parseSignedValue(cookies[SESSION_COOKIE_NAME])
  if (!payload) return null
  if (Math.floor(Date.now() / 1000) > payload.exp) return null
  return payload
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = ''
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('Body too large'))
        return
      }
      data += chunk
    })
    req.on('end', () => {
      try { resolve(JSON.parse(data)) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })

export default async function handler(req, res) {
  const limited = checkRateLimit(req, { windowMs: 60_000, max: 30 })
  if (limited) {
    res.setHeader('Retry-After', Math.ceil(limited.retryAfterMs / 1000))
    res.status(429).json({ error: 'Too many requests.' })
    return
  }

  const method = req.method

  // GET — return current session info (no secrets exposed)
  if (method === 'GET') {
    const session = getSession(req)
    if (!session) {
      res.status(401).json({ error: 'No active Devin session.' })
      return
    }
    res.status(200).json({
      orgId: session.orgId,
      createAsUserId: session.createAsUserId ?? null,
      githubSearchScope: session.githubSearchScope ?? '',
    })
    return
  }

  // POST — save credentials into a signed HttpOnly cookie
  if (method === 'POST') {
    const ct = (req.headers['content-type'] ?? '').toLowerCase()
    if (!ct.includes('application/json')) {
      res.status(415).json({ error: 'Content-Type must be application/json.' })
      return
    }

    let body
    try {
      body = await readBody(req)
    } catch (err) {
      if (err.message === 'Body too large') {
        res.status(413).json({ error: 'Request body too large.' })
      } else {
        res.status(400).json({ error: 'Invalid request body.' })
      }
      return
    }

    const newApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
    const createAsUserId = typeof body.createAsUserId === 'string' ? body.createAsUserId.trim() : ''
    const githubSearchScope = typeof body.githubSearchScope === 'string' ? body.githubSearchScope.trim() : ''

    // Determine which API key to use — new one from request, or existing from cookie
    const existingSession = getSession(req)
    const apiKey = newApiKey || existingSession?.apiKey || ''

    if (!apiKey) {
      res.status(400).json({ error: 'apiKey is required.' })
      return
    }

    if (!orgId) {
      res.status(400).json({ error: 'orgId is required.' })
      return
    }

    // Only validate against Devin API when a new key is provided
    if (newApiKey) {
      const devinBase = 'https://api.devin.ai/v3'
      const endpoint = `${devinBase}/organizations/${encodeURIComponent(orgId)}/sessions?limit=1`

      try {
        const check = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'lysium' },
        })
        if (check.status === 401 || check.status === 403) {
          res.status(401).json({ error: 'Invalid Devin API key.' })
          return
        }
      } catch {
        res.status(502).json({ error: 'Could not reach Devin API.' })
        return
      }
    }

    const payload = {
      apiKey,
      orgId,
      createAsUserId,
      githubSearchScope,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    }

    res.setHeader('Set-Cookie', buildCookie(SESSION_COOKIE_NAME, buildSignedValue(payload), SESSION_TTL_SECONDS))
    res.status(200).json({
      orgId,
      createAsUserId: createAsUserId || null,
      githubSearchScope,
    })
    return
  }

  // DELETE — clear session
  if (method === 'DELETE') {
    res.setHeader('Set-Cookie', clearCookie(SESSION_COOKIE_NAME))
    res.status(204).end()
    return
  }

  res.status(405).json({ error: 'Method not allowed.' })
}
