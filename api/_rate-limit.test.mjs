import { describe, it, expect, beforeEach, vi } from 'vitest'

// The module keeps state in a module-level Map, so we re-import a fresh copy
// for each describe block that needs isolation.  For tests that intentionally
// share state (e.g. counting sequential hits) we import once at the top.

// Helper: build a minimal request-like object
const fakeReq = (ip = '127.0.0.1') => ({
  headers: { 'x-forwarded-for': ip },
  socket: { remoteAddress: ip },
})

// We dynamically import so the module-level Map is fresh per test file run.
// Between describe blocks we rely on different IPs for isolation.
let checkRateLimit

beforeEach(async () => {
  // Reset modules so we get a clean `windows` Map each time
  vi.resetModules()
  const mod = await import('./_rate-limit.mjs')
  checkRateLimit = mod.checkRateLimit
})

describe('_rate-limit', () => {
  // ── basic allow / deny ──────────────────────────────────────────────

  describe('basic allow / deny', () => {
    it('allows requests under the limit', () => {
      const req = fakeReq('10.0.0.1')
      const result = checkRateLimit(req, { windowMs: 60_000, max: 5 })
      expect(result).toBeNull()
    })

    it('denies the request that exceeds the limit', () => {
      const req = fakeReq('10.0.0.2')
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit(req, { windowMs: 60_000, max: 5 })).toBeNull()
      }
      const denied = checkRateLimit(req, { windowMs: 60_000, max: 5 })
      expect(denied).not.toBeNull()
      expect(denied).toHaveProperty('retryAfterMs')
      expect(denied.retryAfterMs).toBeGreaterThan(0)
    })

    it('tracks IPs independently', () => {
      const reqA = fakeReq('10.0.0.3')
      const reqB = fakeReq('10.0.0.4')
      // exhaust A's limit
      for (let i = 0; i < 3; i++) {
        checkRateLimit(reqA, { windowMs: 60_000, max: 3 })
      }
      expect(checkRateLimit(reqA, { windowMs: 60_000, max: 3 })).not.toBeNull()
      // B should still be allowed
      expect(checkRateLimit(reqB, { windowMs: 60_000, max: 3 })).toBeNull()
    })
  })

  // ── IP extraction ───────────────────────────────────────────────────

  describe('IP extraction', () => {
    it('uses the first value in x-forwarded-for', () => {
      const req = {
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
        socket: { remoteAddress: '127.0.0.1' },
      }
      // Should key on 1.2.3.4 — call max+1 times then verify it blocks
      for (let i = 0; i < 2; i++) {
        checkRateLimit(req, { windowMs: 60_000, max: 2 })
      }
      expect(checkRateLimit(req, { windowMs: 60_000, max: 2 })).not.toBeNull()
    })

    it('falls back to socket.remoteAddress when x-forwarded-for is absent', () => {
      const req = { headers: {}, socket: { remoteAddress: '192.168.1.1' } }
      expect(checkRateLimit(req, { windowMs: 60_000, max: 5 })).toBeNull()
    })

    it('uses "unknown" when no IP info is available', () => {
      const req = { headers: {}, socket: {} }
      expect(checkRateLimit(req, { windowMs: 60_000, max: 5 })).toBeNull()
    })
  })

  // ── window expiry ──────────────────────────────────────────────────

  describe('window expiry', () => {
    it('resets the counter after the window elapses', () => {
      const req = fakeReq('10.0.0.10')
      // exhaust limit
      for (let i = 0; i < 3; i++) {
        checkRateLimit(req, { windowMs: 100, max: 3 })
      }
      expect(checkRateLimit(req, { windowMs: 100, max: 3 })).not.toBeNull()

      // advance time past the window
      vi.useFakeTimers()
      vi.advanceTimersByTime(150)

      expect(checkRateLimit(req, { windowMs: 100, max: 3 })).toBeNull()
      vi.useRealTimers()
    })
  })

  // ── default options ────────────────────────────────────────────────

  describe('default options', () => {
    it('uses defaults of windowMs=60000 and max=60', () => {
      const req = fakeReq('10.0.0.20')
      // Should allow 60 requests with defaults
      for (let i = 0; i < 60; i++) {
        expect(checkRateLimit(req)).toBeNull()
      }
      // 61st should be denied
      expect(checkRateLimit(req)).not.toBeNull()
    })
  })

  // ── retryAfterMs value ─────────────────────────────────────────────

  describe('retryAfterMs', () => {
    it('returns the remaining time in the current window', () => {
      vi.useFakeTimers({ now: 1000 })
      const req = fakeReq('10.0.0.30')
      for (let i = 0; i < 2; i++) {
        checkRateLimit(req, { windowMs: 5000, max: 2 })
      }
      // advance 2 seconds into the window
      vi.advanceTimersByTime(2000)
      const denied = checkRateLimit(req, { windowMs: 5000, max: 2 })
      expect(denied).not.toBeNull()
      // resetAt was set at 1000 + 5000 = 6000, now is 3000, so retryAfterMs = 3000
      expect(denied.retryAfterMs).toBe(3000)
      vi.useRealTimers()
    })
  })
})
