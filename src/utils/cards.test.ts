import { describe, it, expect } from 'vitest'
import {
  roundRobinByRepo,
  mapIssueFromGithubSearchItem,
  mapPullRequestFromGithubSearchItem,
} from './cards'
import type { BaseCard, GithubSearchItem } from '../types'

describe('roundRobinByRepo', () => {
  const card = (repo: string, id: number, timestamp: string): BaseCard => ({
    id,
    repo,
    author: 'user',
    avatarUrl: '',
    timestamp,
    title: `Card ${id}`,
    summary: [],
    codeSnippet: '',
  })

  it('interleaves cards from different repos', () => {
    const cards = [
      card('repo-a', 1, '1m'),
      card('repo-a', 2, '2m'),
      card('repo-b', 3, '1m'),
      card('repo-b', 4, '2m'),
    ]

    const result = roundRobinByRepo(cards)
    const repos = result.map((c) => c.repo)
    expect(repos).toEqual(['repo-a', 'repo-b', 'repo-a', 'repo-b'])
  })

  it('handles single repo', () => {
    const cards = [card('repo-a', 1, '1m'), card('repo-a', 2, '2m')]
    const result = roundRobinByRepo(cards)
    expect(result.map((c) => c.id)).toEqual([1, 2])
  })

  it('handles empty input', () => {
    expect(roundRobinByRepo([])).toEqual([])
  })

  it('sorts within each repo by age', () => {
    const cards = [
      card('repo-a', 1, '5m'),
      card('repo-a', 2, '1m'),
    ]
    const result = roundRobinByRepo(cards)
    expect(result.map((c) => c.id)).toEqual([2, 1])
  })
})

describe('mapIssueFromGithubSearchItem', () => {
  const validItem: GithubSearchItem = {
    number: 42,
    title: 'Bug Report',
    body: 'Description',
    repository_url: 'https://api.github.com/repos/owner/repo',
    html_url: 'https://github.com/owner/repo/issues/42',
    updated_at: '2025-01-01T00:00:00Z',
    user: { login: 'alice', avatar_url: 'https://example.com/avatar.png' },
    labels: ['bug'],
  }

  it('maps valid item to IssueCard', () => {
    const result = mapIssueFromGithubSearchItem(validItem)
    expect(result).not.toBe(null)
    expect(result?.kind).toBe('issue')
    expect(result?.id).toBe(42)
    expect(result?.repo).toBe('owner/repo')
    expect(result?.author).toBe('alice')
    expect(result?.title).toBe('Bug Report')
    expect(result?.labels).toEqual(['bug'])
  })

  it('returns null for missing number', () => {
    expect(mapIssueFromGithubSearchItem({ ...validItem, number: undefined })).toBe(null)
  })

  it('returns null for missing repo', () => {
    expect(mapIssueFromGithubSearchItem({
      ...validItem,
      repository_url: undefined,
      html_url: undefined,
    })).toBe(null)
  })

  it('uses fallback author and avatar', () => {
    const result = mapIssueFromGithubSearchItem({ ...validItem, user: null })
    expect(result?.author).toBe('Unknown author')
    expect(result?.avatarUrl).toContain('avatars.githubusercontent.com')
  })
})

describe('mapPullRequestFromGithubSearchItem', () => {
  const validItem: GithubSearchItem = {
    number: 10,
    title: 'Fix typo',
    body: 'Fixes a typo',
    repository_url: 'https://api.github.com/repos/owner/repo',
    updated_at: '2025-01-01T00:00:00Z',
    user: { login: 'bob', avatar_url: 'https://example.com/avatar.png' },
  }

  it('maps valid item to PullRequestCard', () => {
    const result = mapPullRequestFromGithubSearchItem(validItem)
    expect(result).not.toBe(null)
    expect(result?.kind).toBe('pullRequest')
    expect(result?.id).toBe(10)
    expect(result?.additions).toBe(0)
    expect(result?.deletions).toBe(0)
    expect(result?.checks).toEqual([])
  })

  it('returns null for missing number', () => {
    expect(mapPullRequestFromGithubSearchItem({ ...validItem, number: undefined })).toBe(null)
  })
})
