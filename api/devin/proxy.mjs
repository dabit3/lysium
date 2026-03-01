import { parseSignedValue, parseCookies } from '../_cookie.mjs'

const SESSION_COOKIE_NAME = 'elysium_devin_session'
const DEVIN_API_BASE = 'https://api.devin.ai/v3'

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
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

export default async function handler(req, res) {
  const session = getSession(req)
  if (!session) {
    res.status(401).json({ error: 'No active Devin session.' })
    return
  }

  // Strip /api/devin/proxy prefix to get the downstream path
  const url = new URL(req.url, `https://${req.headers.host}`)
  const downstream = url.pathname.replace(/^\/api\/devin\/proxy/, '') || '/'
  const targetUrl = `${DEVIN_API_BASE}${downstream}${url.search}`

  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req)

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
