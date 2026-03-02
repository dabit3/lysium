import { parseSignedValue, parseCookies } from '../_cookie.mjs'
import { checkRateLimit } from '../_rate-limit.mjs'

const SESSION_COOKIE_NAME = 'elysium_devin_session'
const DEVIN_API_BASE = 'https://api.devin.ai/v3'
const MAX_BODY_BYTES = 10 * 1024 // 10 KB

// Only allow the Devin API paths the app actually uses:
//   /organizations/sessions
//   /organizations/{orgId}/sessions
//   /organizations/sessions/{sessionId}
//   /organizations/{orgId}/sessions/{sessionId}
const ALLOWED_PATH_RE = /^\/organizations(?:\/[a-zA-Z0-9_-]+)?\/sessions(?:\/[a-zA-Z0-9_-]+)?$/

const getSession = (req) => {
  const cookies = parseCookies(req.headers.cookie)
  const payload = parseSignedValue(cookies[SESSION_COOKIE_NAME])
  if (!payload) return null
  if (Math.floor(Date.now() / 1000) > payload.exp) return null
  return payload
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('Body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

export default async function handler(req, res) {
  const limited = checkRateLimit(req, { windowMs: 60_000, max: 60 })
  if (limited) {
    res.setHeader('Retry-After', Math.ceil(limited.retryAfterMs / 1000))
    res.status(429).json({ error: 'Too many requests.' })
    return
  }

  const session = getSession(req)
  if (!session) {
    res.status(401).json({ error: 'No active Devin session.' })
    return
  }

  // Strip /api/devin/proxy prefix to get the downstream path
  const url = new URL(req.url, `https://${req.headers.host}`)
  const downstream = url.pathname.replace(/^\/api\/devin\/proxy/, '') || '/'

  if (!ALLOWED_PATH_RE.test(downstream)) {
    res.status(403).json({ error: 'This API path is not allowed through the proxy.' })
    return
  }

  const targetUrl = `${DEVIN_API_BASE}${downstream}${url.search}`

  let body
  if (!['GET', 'HEAD'].includes(req.method)) {
    try {
      body = await readBody(req)
    } catch {
      res.status(413).json({ error: 'Request body too large.' })
      return
    }
  }

  const upstreamRes = await fetch(targetUrl, {
    method: req.method,
    headers: {
      Authorization: `Bearer ${session.apiKey}`,
      'Content-Type': req.headers['content-type'] ?? 'application/json',
      'User-Agent': 'lysium',
    },
    body,
  })

  const contentType = upstreamRes.headers.get('content-type') ?? 'application/json'
  const responseBody = await upstreamRes.arrayBuffer()

  res.status(upstreamRes.status)
  res.setHeader('Content-Type', contentType)
  res.send(Buffer.from(responseBody))
}
