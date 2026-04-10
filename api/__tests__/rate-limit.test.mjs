import { describe, it, expect, beforeEach, vi } from 'vitest'
import { checkRateLimit } from '../_rate-limit.mjs'

/**
 * Helper to build a minimal request object with the given IP.
 */
const fakeReq = (ip = '127.0.0.1') => ({
  headers: { 'x-forwarded-for': ip },
  socket: { remoteAddress: ip },
})

describe('checkRateLimit', () => {
  beforeEach(() => {
    // Advance time far enough to reset any lingering windows and trigger
    // cleanup so that the internal Map starts fresh for each test.
    vi.useFakeTimers()
    vi.advanceTimersByTime(120_000)
    // Make one throwaway call to force cleanup of stale entries
    checkRateLimit(fakeReq('__reset__'), { windowMs: 1, max: 999 })
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Basic allow / deny
  // -------------------------------------------------------------------------
  it('allows requests under the limit', () => {
    const req = fakeReq('10.0.0.1')
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(req, { max: 5, windowMs: 60_000 })).toBeNull()
    }
  })

  it('blocks the request that exceeds the limit', () => {
    const req = fakeReq('10.0.0.2')
    const opts = { max: 3, windowMs: 60_000 }
    // First 3 requests allowed
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(req, opts)).toBeNull()
    }
    // 4th request blocked
    const result = checkRateLimit(req, opts)
    expect(result).not.toBeNull()
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('returns retryAfterMs within the window', () => {
    vi.useFakeTimers()
    const req = fakeReq('10.0.0.3')
    const opts = { max: 1, windowMs: 30_000 }

    checkRateLimit(req, opts) // allowed
    const result = checkRateLimit(req, opts) // blocked
    expect(result).not.toBeNull()
    expect(result.retryAfterMs).toBeLessThanOrEqual(30_000)
    expect(result.retryAfterMs).toBeGreaterThan(0)

    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Window expiry
  // -------------------------------------------------------------------------
  it('resets the count after the window expires', () => {
    vi.useFakeTimers()

    const req = fakeReq('10.0.0.4')
    const opts = { max: 2, windowMs: 10_000 }

    checkRateLimit(req, opts)
    checkRateLimit(req, opts)
    expect(checkRateLimit(req, opts)).not.toBeNull() // blocked

    vi.advanceTimersByTime(11_000) // past the window

    expect(checkRateLimit(req, opts)).toBeNull() // allowed again

    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Per-IP isolation
  // -------------------------------------------------------------------------
  it('tracks different IPs independently', () => {
    const opts = { max: 1, windowMs: 60_000 }

    expect(checkRateLimit(fakeReq('10.0.0.10'), opts)).toBeNull()
    expect(checkRateLimit(fakeReq('10.0.0.11'), opts)).toBeNull()

    // Second request from first IP is blocked
    expect(checkRateLimit(fakeReq('10.0.0.10'), opts)).not.toBeNull()
    // Second request from second IP is also blocked
    expect(checkRateLimit(fakeReq('10.0.0.11'), opts)).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // IP extraction
  // -------------------------------------------------------------------------
  it('uses x-forwarded-for header (first entry) for the IP', () => {
    const req = {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      socket: { remoteAddress: '127.0.0.1' },
    }
    const opts = { max: 1, windowMs: 60_000 }

    checkRateLimit(req, opts)
    // A different req object but same forwarded IP should be rate limited
    const req2 = {
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '127.0.0.1' },
    }
    expect(checkRateLimit(req2, opts)).not.toBeNull()
  })

  it('falls back to socket.remoteAddress when x-forwarded-for is absent', () => {
    const req = {
      headers: {},
      socket: { remoteAddress: '192.168.1.100' },
    }
    const opts = { max: 1, windowMs: 60_000 }

    checkRateLimit(req, opts)
    expect(checkRateLimit(req, opts)).not.toBeNull()
  })

  it('uses "unknown" when no IP info is available', () => {
    const req = { headers: {}, socket: {} }
    const opts = { max: 1, windowMs: 60_000 }

    checkRateLimit(req, opts)
    // Both requests with no IP info share the "unknown" bucket
    const req2 = { headers: {}, socket: {} }
    expect(checkRateLimit(req2, opts)).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // Defaults
  // -------------------------------------------------------------------------
  it('applies default max=60 and windowMs=60000 when no opts given', () => {
    const req = fakeReq('10.0.0.20')
    // Should allow 60 requests by default
    for (let i = 0; i < 60; i++) {
      expect(checkRateLimit(req)).toBeNull()
    }
    expect(checkRateLimit(req)).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------
  it('cleans up expired entries after the cleanup interval', () => {
    vi.useFakeTimers()

    // beforeEach left lastCleanup ~120s in the future (relative to fake
    // clock). Advance past it + CLEANUP_INTERVAL_MS so the cleanup guard
    // (now - lastCleanup >= 60_000) can pass, then make a warmup call to
    // reset lastCleanup to the current fake time.
    vi.advanceTimersByTime(200_000)
    checkRateLimit(fakeReq('__cleanup_warmup__'), { windowMs: 1, max: 999 })

    const opts = { max: 1, windowMs: 5_000 }
    checkRateLimit(fakeReq('10.0.0.30'), opts)

    // Advance past the window AND the cleanup interval (60s) so cleanup
    // actually runs and prunes the stale entry from the internal Map.
    vi.advanceTimersByTime(65_000)

    // The entry should be cleaned up; a new request is allowed
    expect(checkRateLimit(fakeReq('10.0.0.30'), opts)).toBeNull()

    vi.useRealTimers()
  })
})
