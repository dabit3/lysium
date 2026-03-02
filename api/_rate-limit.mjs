// Simple in-memory sliding-window rate limiter.
// Works within a single serverless instance — requests across cold starts are
// not tracked. For stricter guarantees, use Vercel WAF or an external store.

const windows = new Map()

const CLEANUP_INTERVAL_MS = 60_000
let lastCleanup = Date.now()

const cleanup = (windowMs) => {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  const cutoff = now - windowMs
  for (const [key, entry] of windows) {
    if (entry.resetAt < cutoff) windows.delete(key)
  }
}

/**
 * Returns null if the request is allowed, or a { status, headers } object
 * to send as a 429 response if the limit is exceeded.
 *
 * @param {import('http').IncomingMessage} req
 * @param {{ windowMs?: number, max?: number }} opts
 */
export const checkRateLimit = (req, { windowMs = 60_000, max = 60 } = {}) => {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'

  const now = Date.now()
  cleanup(windowMs)

  let entry = windows.get(ip)
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs }
    windows.set(ip, entry)
  }

  entry.count++

  if (entry.count > max) {
    return {
      retryAfterMs: entry.resetAt - now,
    }
  }

  return null
}
