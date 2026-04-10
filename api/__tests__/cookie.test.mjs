import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  sign,
  buildSignedValue,
  parseSignedValue,
  parseCookies,
  buildCookie,
  clearCookie,
} from '../_cookie.mjs'

const TEST_SECRET = 'a]3Kf$9xLm!Qz7Wv@Rp2Yc&Tn#Hj6Bd*E'

beforeEach(() => {
  vi.stubEnv('GITHUB_OAUTH_COOKIE_SECRET', TEST_SECRET)
  vi.stubEnv('GITHUB_OAUTH_COOKIE_SECURE', '')
  vi.stubEnv('GITHUB_OAUTH_COOKIE_DOMAIN', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// sign
// ---------------------------------------------------------------------------
describe('sign', () => {
  it('returns a hex string', () => {
    const sig = sign('hello')
    expect(sig).toMatch(/^[0-9a-f]+$/)
  })

  it('is deterministic for the same input and secret', () => {
    expect(sign('data')).toBe(sign('data'))
  })

  it('produces different signatures for different inputs', () => {
    expect(sign('a')).not.toBe(sign('b'))
  })

  it('produces different signatures for different secrets', () => {
    const sig1 = sign('payload')
    vi.stubEnv(
      'GITHUB_OAUTH_COOKIE_SECRET',
      'x$9Kf!3LmQz7Wv@Rp2Yc&Tn#Hj6Bd*Ea]',
    )
    const sig2 = sign('payload')
    expect(sig1).not.toBe(sig2)
  })
})

// ---------------------------------------------------------------------------
// buildSignedValue / parseSignedValue
// ---------------------------------------------------------------------------
describe('buildSignedValue / parseSignedValue', () => {
  it('round-trips a plain object', () => {
    const payload = { token: 'ghp_abc123', user: 'nader' }
    const cookie = buildSignedValue(payload)
    expect(parseSignedValue(cookie)).toEqual(payload)
  })

  it('round-trips an empty object', () => {
    const cookie = buildSignedValue({})
    expect(parseSignedValue(cookie)).toEqual({})
  })

  it('round-trips nested data', () => {
    const payload = { a: { b: [1, 2, 3] } }
    expect(parseSignedValue(buildSignedValue(payload))).toEqual(payload)
  })

  it('returns null for tampered ciphertext', () => {
    const cookie = buildSignedValue({ secret: true })
    // Flip a character in the encrypted portion (before the dot)
    const dot = cookie.lastIndexOf('.')
    const data = cookie.slice(0, dot)
    const sig = cookie.slice(dot + 1)
    const tampered =
      data.slice(0, 5) +
      (data[5] === 'A' ? 'B' : 'A') +
      data.slice(6) +
      '.' +
      sig
    expect(parseSignedValue(tampered)).toBeNull()
  })

  it('returns null for tampered signature', () => {
    const cookie = buildSignedValue({ secret: true })
    const tampered = cookie.slice(0, -1) + (cookie.at(-1) === 'a' ? 'b' : 'a')
    expect(parseSignedValue(tampered)).toBeNull()
  })

  it('returns null for null / undefined / empty string', () => {
    expect(parseSignedValue(null)).toBeNull()
    expect(parseSignedValue(undefined)).toBeNull()
    expect(parseSignedValue('')).toBeNull()
  })

  it('returns null for a value without a dot separator', () => {
    expect(parseSignedValue('nodot')).toBeNull()
  })

  it('returns null when decrypted with a different secret', () => {
    const cookie = buildSignedValue({ key: 'value' })
    vi.stubEnv(
      'GITHUB_OAUTH_COOKIE_SECRET',
      'x$9Kf!3LmQz7Wv@Rp2Yc&Tn#Hj6Bd*Ea]',
    )
    expect(parseSignedValue(cookie)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// secret validation
// ---------------------------------------------------------------------------
describe('secret validation', () => {
  it('throws when GITHUB_OAUTH_COOKIE_SECRET is missing', () => {
    vi.stubEnv('GITHUB_OAUTH_COOKIE_SECRET', '')
    expect(() => sign('x')).toThrow('GITHUB_OAUTH_COOKIE_SECRET')
  })

  it('throws when secret is too short', () => {
    vi.stubEnv('GITHUB_OAUTH_COOKIE_SECRET', 'short')
    expect(() => sign('x')).toThrow('at least 32 characters')
  })
})

// ---------------------------------------------------------------------------
// parseCookies
// ---------------------------------------------------------------------------
describe('parseCookies', () => {
  it('parses a typical cookie header', () => {
    expect(parseCookies('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' })
  })

  it('handles URL-encoded values', () => {
    const header = 'token=hello%20world; name=foo%3Dbar'
    expect(parseCookies(header)).toEqual({
      token: 'hello world',
      name: 'foo=bar',
    })
  })

  it('returns empty object for empty / falsy input', () => {
    expect(parseCookies('')).toEqual({})
    expect(parseCookies(null)).toEqual({})
    expect(parseCookies(undefined)).toEqual({})
  })

  it('skips entries without =', () => {
    expect(parseCookies('good=1; bad; also_good=2')).toEqual({
      good: '1',
      also_good: '2',
    })
  })

  it('handles values containing =', () => {
    expect(parseCookies('data=a=b=c')).toEqual({ data: 'a=b=c' })
  })

  it('trims whitespace around keys and values', () => {
    expect(parseCookies('  key  =  value  ')).toEqual({ key: 'value' })
  })
})

// ---------------------------------------------------------------------------
// buildCookie
// ---------------------------------------------------------------------------
describe('buildCookie', () => {
  it('builds a basic cookie string', () => {
    const cookie = buildCookie('session', 'abc123', 3600)
    expect(cookie).toContain('session=abc123')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Max-Age=3600')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toContain('Secure')
  })

  it('includes Secure flag when GITHUB_OAUTH_COOKIE_SECURE is true', () => {
    vi.stubEnv('GITHUB_OAUTH_COOKIE_SECURE', 'true')
    expect(buildCookie('s', 'v', 60)).toContain('Secure')
  })

  it('recognises various truthy values for Secure', () => {
    for (const val of ['1', 'TRUE', 'yes', 'ON']) {
      vi.stubEnv('GITHUB_OAUTH_COOKIE_SECURE', val)
      expect(buildCookie('s', 'v', 60)).toContain('Secure')
    }
  })

  it('does not include Secure for non-truthy values', () => {
    for (const val of ['0', 'false', 'no', 'off', '']) {
      vi.stubEnv('GITHUB_OAUTH_COOKIE_SECURE', val)
      expect(buildCookie('s', 'v', 60)).not.toContain('Secure')
    }
  })

  it('includes Domain when GITHUB_OAUTH_COOKIE_DOMAIN is set', () => {
    vi.stubEnv('GITHUB_OAUTH_COOKIE_DOMAIN', '.example.com')
    expect(buildCookie('s', 'v', 60)).toContain('Domain=.example.com')
  })

  it('omits Domain when env var is empty', () => {
    vi.stubEnv('GITHUB_OAUTH_COOKIE_DOMAIN', '')
    expect(buildCookie('s', 'v', 60)).not.toContain('Domain')
  })

  it('URL-encodes the value', () => {
    const cookie = buildCookie('tok', 'a b&c', 60)
    expect(cookie).toContain('tok=a%20b%26c')
  })
})

// ---------------------------------------------------------------------------
// clearCookie
// ---------------------------------------------------------------------------
describe('clearCookie', () => {
  it('produces a cookie with Max-Age=0 and empty value', () => {
    const cookie = clearCookie('session')
    expect(cookie).toContain('session=')
    expect(cookie).toContain('Max-Age=0')
  })
})
