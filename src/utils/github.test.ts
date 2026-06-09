import { describe, it, expect } from 'vitest'
import {
  normalizeGithubScopeQualifier,
  getRepoPathFromGithubSearchItem,
  normalizeGithubLabels,
  extractGithubOauthToken,
  extractGithubOauthLogin,
} from './github'

describe('normalizeGithubScopeQualifier', () => {
  it('returns empty for empty input', () => {
    expect(normalizeGithubScopeQualifier('')).toBe('')
    expect(normalizeGithubScopeQualifier('  ')).toBe('')
  })

  it('passes through values already containing colon', () => {
    expect(normalizeGithubScopeQualifier('org:acme')).toBe('org:acme')
    expect(normalizeGithubScopeQualifier('user:alice')).toBe('user:alice')
  })

  it('prefixes bare values with org:', () => {
    expect(normalizeGithubScopeQualifier('acme')).toBe('org:acme')
  })

  it('trims whitespace', () => {
    expect(normalizeGithubScopeQualifier('  acme  ')).toBe('org:acme')
  })
})

describe('getRepoPathFromGithubSearchItem', () => {
  it('extracts from repository_url', () => {
    expect(getRepoPathFromGithubSearchItem({
      repository_url: 'https://api.github.com/repos/owner/repo',
    })).toBe('owner/repo')
  })

  it('extracts from html_url', () => {
    expect(getRepoPathFromGithubSearchItem({
      html_url: 'https://github.com/owner/repo/issues/1',
    })).toBe('owner/repo')
  })

  it('prefers repository_url over html_url', () => {
    expect(getRepoPathFromGithubSearchItem({
      repository_url: 'https://api.github.com/repos/owner1/repo1',
      html_url: 'https://github.com/owner2/repo2/issues/1',
    })).toBe('owner1/repo1')
  })

  it('returns empty for missing URLs', () => {
    expect(getRepoPathFromGithubSearchItem({})).toBe('')
  })
})

describe('normalizeGithubLabels', () => {
  it('handles string labels', () => {
    expect(normalizeGithubLabels(['bug', 'feature'])).toEqual(['bug', 'feature'])
  })

  it('handles object labels with name property', () => {
    expect(normalizeGithubLabels([{ name: 'bug' }, { name: 'feature' }]))
      .toEqual(['bug', 'feature'])
  })

  it('filters empty labels', () => {
    expect(normalizeGithubLabels(['', { name: '' }, 'valid'])).toEqual(['valid'])
  })

  it('limits to 6 labels', () => {
    const labels = Array.from({ length: 10 }, (_, i) => `label-${i}`)
    expect(normalizeGithubLabels(labels)).toHaveLength(6)
  })

  it('returns empty for non-array', () => {
    expect(normalizeGithubLabels(undefined)).toEqual([])
  })
})

describe('extractGithubOauthToken', () => {
  it('extracts access_token', () => {
    expect(extractGithubOauthToken({ access_token: 'tok123' })).toBe('tok123')
  })

  it('extracts accessToken', () => {
    expect(extractGithubOauthToken({ accessToken: 'tok456' })).toBe('tok456')
  })

  it('extracts token', () => {
    expect(extractGithubOauthToken({ token: 'tok789' })).toBe('tok789')
  })

  it('returns empty for null/undefined', () => {
    expect(extractGithubOauthToken(null)).toBe('')
    expect(extractGithubOauthToken(undefined)).toBe('')
  })

  it('trims whitespace', () => {
    expect(extractGithubOauthToken({ access_token: '  tok  ' })).toBe('tok')
  })
})

describe('extractGithubOauthLogin', () => {
  it('extracts login', () => {
    expect(extractGithubOauthLogin({ login: 'alice' })).toBe('alice')
  })

  it('extracts username', () => {
    expect(extractGithubOauthLogin({ username: 'bob' })).toBe('bob')
  })

  it('extracts nested user.login', () => {
    expect(extractGithubOauthLogin({ user: { login: 'charlie' } })).toBe('charlie')
  })

  it('returns null for missing data', () => {
    expect(extractGithubOauthLogin(null)).toBe(null)
    expect(extractGithubOauthLogin({})).toBe(null)
  })
})
