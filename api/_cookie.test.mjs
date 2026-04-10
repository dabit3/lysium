import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  sign,
  buildSignedValue,
  parseSignedValue,
  parseCookies,
  buildCookie,
  clearCookie,
} from './_cookie.mjs'

const TEST_SECRET = 'a]3Fz!9Qr#Lm$Wp^Tv&Xk8Bn*Yj2Hc6D'

describe('_cookie', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_OAUTH_COOKIE_SECRET', TEST_SECRET)
    vi.stubEnv('GITHUB_OAUTH_COOKIE_SECURE', '')
    vi.stubEnv('GITHUB_OAUTH_COOKIE_DOMAIN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // ── secret validation ──────────────────────────────────────────────

  describe('secret validation', () => {
    it('throws when GITHUB_OAUTH_COOKIE_SECRET is missing', () => {
      vi.stubEnv('GITHUB_OAUTH_COOKIE_SECRET', '')
      expect(() => sign('anything')).toThrow(
        /GITHUB_OAUTH_COOKIE_SECRET must be set/,
      )
    })

    it('throws when secret is shorter than 32 characters', () => {
      vi.stubEnv('GITHUB_OAUTH_COOKIE_SECRET', 'short')
      expect(() => sign('anything')).toThrow(/at least 32 characters/)
    })
  })

  // ── sign ───────────────────────────────────────────────────────────

  describe('sign', () => {
    it('returns a hex string', () => {
      const result = sign('hello')
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('is deterministic for the same input and secret', () => {
      expect(sign('hello')).toBe(sign('hello'))
    })

    it('produces different signatures for different inputs', () => {
      expect(sign('hello')).not.toBe(sign('world'))
    })
  })

  // ── buildSignedValue / parseSignedValue roundtrip ──────────────────

  describe('buildSignedValue / parseSignedValue', () => {
    it('roundtrips a simple object', () => {
      const payload = { user: 'nader', role: 'admin' }
      const signed = buildSignedValue(payload)
      expect(parseSignedValue(signed)).toEqual(payload)
    })

    it('roundtrips nested objects and arrays', () => {
      const payload = { items: [1, 2, 3], meta: { ok: true } }
      const signed = buildSignedValue(payload)
      expect(parseSignedValue(signed)).toEqual(payload)
    })

    it('returns null for empty/null/undefined input', () => {
      expect(parseSignedValue(null)).toBeNull()
      expect(parseSignedValue(undefined)).toBeNull()
      expect(parseSignedValue('')).toBeNull()
    })

    it('returns null when the signature is tampered with', () => {
      const signed = buildSignedValue({ a: 1 })
      const tampered = signed.slice(0, -1) + (signed.at(-1) === '0' ? '1' : '0')
      expect(parseSignedValue(tampered)).toBeNull()
    })

    it('returns null when the ciphertext is tampered with', () => {
      const signed = buildSignedValue({ a: 1 })
      const dot = signed.lastIndexOf('.')
      const data = signed.slice(0, dot)
      const sig = signed.slice(dot + 1)
      // flip a character in the ciphertext
      const flipped =
        data.slice(0, 5) +
        (data[5] === 'A' ? 'B' : 'A') +
        data.slice(6)
      expect(parseSignedValue(`${flipped}.${sig}`)).toBeNull()
    })

    it('returns null for a value with no dot separator', () => {
      expect(parseSignedValue('nodothere')).toBeNull()
    })

    it('returns null when a different secret is used to parse', () => {
      const signed = buildSignedValue({ secret: 'data' })
      vi.stubEnv(
        'GITHUB_OAUTH_COOKIE_SECRET',
        'Zx9!kR#mL$vW^pT&bN*yJ2hC6dFa3qEu7',
      )
      expect(parseSignedValue(signed)).toBeNull()
    })
  })

  // ── parseCookies ───────────────────────────────────────────────────

  describe('parseCookies', () => {
    it('returns an empty object for null/undefined/empty header', () => {
      expect(parseCookies(null)).toEqual({})
      expect(parseCookies(undefined)).toEqual({})
      expect(parseCookies('')).toEqual({})
    })

    it('parses a single cookie', () => {
      expect(parseCookies('foo=bar')).toEqual({ foo: 'bar' })
    })

    it('parses multiple cookies', () => {
      expect(parseCookies('a=1; b=2; c=3')).toEqual({
        a: '1',
        b: '2',
        c: '3',
      })
    })

    it('handles URI-encoded values', () => {
      expect(parseCookies('name=%E2%9C%93')).toEqual({ name: '\u2713' })
    })

    it('handles cookies with = in the value', () => {
      expect(parseCookies('token=abc=def=')).toEqual({ token: 'abc=def=' })
    })

    it('skips malformed pairs with no key', () => {
      expect(parseCookies('=onlyvalue; good=ok')).toEqual({ good: 'ok' })
    })
  })

  // ── buildCookie ────────────────────────────────────────────────────

  describe('buildCookie', () => {
    it('builds a basic cookie string with required attributes', () => {
      const cookie = buildCookie('session', 'abc123', 3600)
      expect(cookie).toContain('session=abc123')
      expect(cookie).toContain('Path=/')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Max-Age=3600')
      expect(cookie).toContain('HttpOnly')
    })

    it('does not include Secure when GITHUB_OAUTH_COOKIE_SECURE is falsy', () => {
      vi.stubEnv('GITHUB_OAUTH_COOKIE_SECURE', '')
      const cookie = buildCookie('s', 'v', 10)
      expect(cookie).not.toContain('Secure')
    })

    it('includes Secure when GITHUB_OAUTH_COOKIE_SECURE is "true"', () => {
      vi.stubEnv('GITHUB_OAUTH_COOKIE_SECURE', 'true')
      const cookie = buildCookie('s', 'v', 10)
      expect(cookie).toContain('Secure')
    })

    it('includes Secure for truthy values: "1", "yes", "on"', () => {
      for (const val of ['1', 'yes', 'on', 'TRUE', 'Yes']) {
        vi.stubEnv('GITHUB_OAUTH_COOKIE_SECURE', val)
        expect(buildCookie('s', 'v', 10)).toContain('Secure')
      }
    })

    it('does not include Domain when env var is empty', () => {
      vi.stubEnv('GITHUB_OAUTH_COOKIE_DOMAIN', '')
      const cookie = buildCookie('s', 'v', 10)
      expect(cookie).not.toContain('Domain=')
    })

    it('includes Domain when env var is set', () => {
      vi.stubEnv('GITHUB_OAUTH_COOKIE_DOMAIN', '.example.com')
      const cookie = buildCookie('s', 'v', 10)
      expect(cookie).toContain('Domain=.example.com')
    })

    it('URI-encodes the value', () => {
      const cookie = buildCookie('k', 'hello world', 10)
      expect(cookie).toContain('k=hello%20world')
    })
  })

  // ── clearCookie ────────────────────────────────────────────────────

  describe('clearCookie', () => {
    it('returns a cookie with empty value and Max-Age=0', () => {
      const cookie = clearCookie('session')
      expect(cookie).toContain('session=')
      expect(cookie).toContain('Max-Age=0')
    })
  })
})
