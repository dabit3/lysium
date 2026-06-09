import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  toIssueAssessmentKey,
  parseRepoAndIssueNumberFromJobTarget,
  toIssueAssessmentKeyFromJobTarget,
  toAssessedIssueEntry,
  loadPersistedJobs,
  savePersistedJobs,
  findLatestIssueAssessmentSessionUrl,
  findLatestPullRequestAssessmentSessionUrl,
} from './storage'
import type { JobEntry } from '../types'

describe('toIssueAssessmentKey', () => {
  it('builds key from repo and id', () => {
    expect(toIssueAssessmentKey({ repo: 'Owner/Repo', id: 42 })).toBe('owner/repo#42')
  })

  it('normalizes GitHub URLs', () => {
    expect(toIssueAssessmentKey({ repo: 'https://github.com/owner/repo', id: 1 }))
      .toBe('owner/repo#1')
  })

  it('returns empty for invalid repo', () => {
    expect(toIssueAssessmentKey({ repo: '', id: 1 })).toBe('')
  })

  it('returns empty for non-finite id', () => {
    expect(toIssueAssessmentKey({ repo: 'owner/repo', id: NaN })).toBe('')
  })

  it('truncates fractional ids', () => {
    expect(toIssueAssessmentKey({ repo: 'owner/repo', id: 42.9 })).toBe('owner/repo#42')
  })
})

describe('parseRepoAndIssueNumberFromJobTarget', () => {
  it('parses valid target', () => {
    expect(parseRepoAndIssueNumberFromJobTarget('owner/repo #123'))
      .toEqual({ repo: 'owner/repo', id: 123 })
  })

  it('returns null for invalid format', () => {
    expect(parseRepoAndIssueNumberFromJobTarget('invalid')).toBe(null)
    expect(parseRepoAndIssueNumberFromJobTarget('')).toBe(null)
  })
})

describe('toIssueAssessmentKeyFromJobTarget', () => {
  it('converts job target to assessment key', () => {
    expect(toIssueAssessmentKeyFromJobTarget('owner/repo #42'))
      .toBe('owner/repo#42')
  })

  it('returns empty for unparseable target', () => {
    expect(toIssueAssessmentKeyFromJobTarget('invalid')).toBe('')
  })
})

describe('toAssessedIssueEntry', () => {
  it('handles numeric timestamp', () => {
    expect(toAssessedIssueEntry(1000)).toEqual({ assessedAt: 1000 })
  })

  it('handles object with assessedAt', () => {
    const result = toAssessedIssueEntry({ assessedAt: 5000 })
    expect(result?.assessedAt).toBe(5000)
  })

  it('handles object with sessionUrl', () => {
    const result = toAssessedIssueEntry({
      assessedAt: 1000,
      sessionUrl: 'https://app.devin.ai/sessions/abc',
    })
    expect(result?.sessionUrl).toBe('https://app.devin.ai/sessions/abc')
    expect(result?.sessionId).toBe('abc')
  })

  it('returns null for invalid input', () => {
    expect(toAssessedIssueEntry(null)).toBe(null)
    expect(toAssessedIssueEntry(undefined)).toBe(null)
    expect(toAssessedIssueEntry('string')).toBe(null)
    expect(toAssessedIssueEntry([])).toBe(null)
    expect(toAssessedIssueEntry(NaN)).toBe(null)
    expect(toAssessedIssueEntry(Infinity)).toBe(null)
  })

  it('returns null for object without valid timestamp', () => {
    expect(toAssessedIssueEntry({ assessedAt: 'not-a-number' })).toBe(null)
  })
})

describe('loadPersistedJobs / savePersistedJobs', () => {
  beforeEach(() => {
    const store: Record<string, string> = {}
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          store[key] = value
        }),
      },
    })
  })

  it('returns empty array when storage is empty', () => {
    expect(loadPersistedJobs()).toEqual([])
  })

  it('round-trips jobs through storage', () => {
    const jobs: JobEntry[] = [{
      id: 1,
      label: 'test',
      target: 'owner/repo #1',
      status: 'running',
      message: 'Running...',
      retryable: false,
      createdAt: Date.now(),
    }]

    savePersistedJobs(jobs)
    expect(loadPersistedJobs()).toEqual(jobs)
  })
})

describe('findLatestIssueAssessmentSessionUrl', () => {
  const makeJob = (overrides: Partial<JobEntry>): JobEntry => ({
    id: 1,
    label: 'Assess Necessity',
    target: 'owner/repo #42',
    status: 'success',
    message: 'Done',
    retryable: false,
    createdAt: Date.now(),
    sessionUrl: 'https://app.devin.ai/sessions/abc',
    ...overrides,
  })

  it('finds matching job session URL', () => {
    const jobs = [makeJob({})]
    expect(findLatestIssueAssessmentSessionUrl(jobs, 'owner/repo#42'))
      .toBe('https://app.devin.ai/sessions/abc')
  })

  it('returns undefined when no match', () => {
    const jobs = [makeJob({ target: 'other/repo #1' })]
    expect(findLatestIssueAssessmentSessionUrl(jobs, 'owner/repo#42'))
      .toBe(undefined)
  })

  it('skips non-success jobs', () => {
    const jobs = [makeJob({ status: 'failed' })]
    expect(findLatestIssueAssessmentSessionUrl(jobs, 'owner/repo#42'))
      .toBe(undefined)
  })
})

describe('findLatestPullRequestAssessmentSessionUrl', () => {
  const makeJob = (overrides: Partial<JobEntry>): JobEntry => ({
    id: 1,
    label: 'Assess Merge Decision',
    target: 'owner/repo #10',
    status: 'success',
    message: 'Done',
    retryable: false,
    createdAt: Date.now(),
    sessionUrl: 'https://app.devin.ai/sessions/xyz',
    ...overrides,
  })

  it('finds matching PR assessment session URL', () => {
    const jobs = [makeJob({})]
    expect(findLatestPullRequestAssessmentSessionUrl(jobs, 'owner/repo#10'))
      .toBe('https://app.devin.ai/sessions/xyz')
  })

  it('returns undefined when no match', () => {
    expect(findLatestPullRequestAssessmentSessionUrl([], 'owner/repo#10'))
      .toBe(undefined)
  })
})
