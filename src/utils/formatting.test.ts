import { describe, it, expect } from 'vitest'
import {
  isTerminalDevinStatus,
  formatDevinStatusLabel,
  devinStatusToBadgeClass,
  formatRelativeTime,
  normalizeRepoPath,
  normalizeSummaryLine,
  stripMarkdownCodeBlocks,
  toSessionIdFromSessionUrl,
  formatSessionReference,
  extractCommentBodyFromRetryPayload,
  parseAgeInMinutes,
  toSummaryLines,
  toCodeSnippet,
  isMergeConflictErrorMessage,
  buildDevinReviewPullRequestUrl,
} from './formatting'

describe('isTerminalDevinStatus', () => {
  it('returns true for terminal statuses', () => {
    expect(isTerminalDevinStatus('finished')).toBe(true)
    expect(isTerminalDevinStatus('stopped')).toBe(true)
    expect(isTerminalDevinStatus('exit')).toBe(true)
    expect(isTerminalDevinStatus('error')).toBe(true)
  })

  it('returns false for non-terminal statuses', () => {
    expect(isTerminalDevinStatus('running')).toBe(false)
    expect(isTerminalDevinStatus('suspended')).toBe(false)
    expect(isTerminalDevinStatus('blocked')).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isTerminalDevinStatus(undefined)).toBe(false)
  })
})

describe('formatDevinStatusLabel', () => {
  it('maps known statuses to labels', () => {
    expect(formatDevinStatusLabel('running')).toBe('Running')
    expect(formatDevinStatusLabel('suspended')).toBe('Suspended')
    expect(formatDevinStatusLabel('exit')).toBe('Exited')
    expect(formatDevinStatusLabel('error')).toBe('Error')
    expect(formatDevinStatusLabel('finished')).toBe('Finished')
    expect(formatDevinStatusLabel('stopped')).toBe('Stopped')
    expect(formatDevinStatusLabel('blocked')).toBe('Blocked')
  })

  it('capitalizes unknown statuses', () => {
    expect(formatDevinStatusLabel('pending')).toBe('Pending')
    expect(formatDevinStatusLabel('custom')).toBe('Custom')
  })
})

describe('devinStatusToBadgeClass', () => {
  it('returns correct badge class for each status', () => {
    expect(devinStatusToBadgeClass('running')).toBe('badge-running')
    expect(devinStatusToBadgeClass('suspended')).toBe('badge-suspended')
    expect(devinStatusToBadgeClass('blocked')).toBe('badge-suspended')
    expect(devinStatusToBadgeClass('exit')).toBe('badge-exit')
    expect(devinStatusToBadgeClass('finished')).toBe('badge-exit')
    expect(devinStatusToBadgeClass('error')).toBe('badge-error')
    expect(devinStatusToBadgeClass('unknown')).toBe('badge-default')
  })
})

describe('formatRelativeTime', () => {
  it('formats seconds', () => {
    expect(formatRelativeTime(Date.now() - 30_000)).toBe('30s ago')
  })

  it('formats minutes', () => {
    expect(formatRelativeTime(Date.now() - 120_000)).toBe('2m ago')
  })

  it('formats hours', () => {
    expect(formatRelativeTime(Date.now() - 7_200_000)).toBe('2h ago')
  })

  it('formats days', () => {
    expect(formatRelativeTime(Date.now() - 172_800_000)).toBe('2d ago')
  })

  it('clamps negative deltas to 0s', () => {
    expect(formatRelativeTime(Date.now() + 10_000)).toBe('0s ago')
  })
})

describe('normalizeRepoPath', () => {
  it('strips HTTPS GitHub prefix', () => {
    expect(normalizeRepoPath('https://github.com/owner/repo')).toBe('owner/repo')
  })

  it('strips bare github.com prefix', () => {
    expect(normalizeRepoPath('github.com/owner/repo')).toBe('owner/repo')
  })

  it('strips .git suffix', () => {
    expect(normalizeRepoPath('owner/repo.git')).toBe('owner/repo')
  })

  it('strips leading slashes', () => {
    expect(normalizeRepoPath('///owner/repo')).toBe('owner/repo')
  })

  it('returns empty for non-string', () => {
    expect(normalizeRepoPath(null)).toBe('')
    expect(normalizeRepoPath(42)).toBe('')
    expect(normalizeRepoPath(undefined)).toBe('')
  })

  it('trims whitespace', () => {
    expect(normalizeRepoPath('  owner/repo  ')).toBe('owner/repo')
  })
})

describe('normalizeSummaryLine', () => {
  it('strips heading markers', () => {
    expect(normalizeSummaryLine('### Section Title')).toBe('Section Title')
  })

  it('strips leading dashes', () => {
    expect(normalizeSummaryLine('--- Item')).toBe('Item')
  })

  it('trims whitespace', () => {
    expect(normalizeSummaryLine('  text  ')).toBe('text')
  })
})

describe('stripMarkdownCodeBlocks', () => {
  it('removes fenced code blocks', () => {
    expect(stripMarkdownCodeBlocks('before\n```\ncode\n```\nafter')).toBe('before\n\n\nafter')
  })

  it('handles empty string', () => {
    expect(stripMarkdownCodeBlocks('')).toBe('')
  })
})

describe('toSessionIdFromSessionUrl', () => {
  it('extracts session ID from URL', () => {
    expect(toSessionIdFromSessionUrl('https://app.devin.ai/sessions/abc123'))
      .toBe('abc123')
  })

  it('returns undefined for missing URL', () => {
    expect(toSessionIdFromSessionUrl(undefined)).toBe(undefined)
  })

  it('returns undefined for URL without sessions path', () => {
    expect(toSessionIdFromSessionUrl('https://example.com/other')).toBe(undefined)
  })

  it('decodes URI-encoded session IDs', () => {
    expect(toSessionIdFromSessionUrl('https://app.devin.ai/sessions/abc%20123'))
      .toBe('abc 123')
  })
})

describe('formatSessionReference', () => {
  it('returns session ID and URL when both present', () => {
    expect(formatSessionReference({
      session_id: 'abc',
      url: 'https://example.com',
    })).toBe('Session abc • https://example.com')
  })

  it('returns session ID only', () => {
    expect(formatSessionReference({ session_id: 'abc' })).toBe('Session abc')
  })

  it('returns URL only', () => {
    expect(formatSessionReference({ url: 'https://example.com' })).toBe('https://example.com')
  })

  it('returns fallback when neither present', () => {
    expect(formatSessionReference({})).toBe('Session started')
  })
})

describe('extractCommentBodyFromRetryPayload', () => {
  it('extracts comment body between markers', () => {
    const payload = 'Comment body: Hello world\n\nPull request context: some context'
    expect(extractCommentBodyFromRetryPayload(payload)).toBe('Hello world')
  })

  it('returns full payload when markers not found', () => {
    expect(extractCommentBodyFromRetryPayload('plain text')).toBe('plain text')
  })

  it('returns empty for empty input', () => {
    expect(extractCommentBodyFromRetryPayload('')).toBe('')
  })
})

describe('parseAgeInMinutes', () => {
  it('parses minutes', () => {
    expect(parseAgeInMinutes('5m ago')).toBe(5)
  })

  it('parses hours', () => {
    expect(parseAgeInMinutes('2h ago')).toBe(120)
  })

  it('parses days', () => {
    expect(parseAgeInMinutes('1d ago')).toBe(1440)
  })

  it('returns MAX_SAFE_INTEGER for unparseable', () => {
    expect(parseAgeInMinutes('just now')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('toSummaryLines', () => {
  it('returns array values as-is when valid', () => {
    expect(toSummaryLines(['line1', 'line2'], 'fallback')).toEqual(['line1', 'line2'])
  })

  it('splits string on newlines', () => {
    expect(toSummaryLines('line1\nline2', 'fallback')).toEqual(['line1', 'line2'])
  })

  it('returns fallback when value is null', () => {
    expect(toSummaryLines(null, 'fallback')).toEqual(['fallback'])
  })

  it('respects maxLines', () => {
    expect(toSummaryLines(['a', 'b', 'c', 'd'], 'fallback', 2)).toEqual(['a', 'b'])
  })

  it('filters empty strings from arrays', () => {
    expect(toSummaryLines(['', '', ''], 'fallback')).toEqual(['fallback'])
  })
})

describe('toCodeSnippet', () => {
  it('extracts code from markdown code blocks', () => {
    const input = 'Some text\n```js\nconst x = 1\n```\nMore text'
    expect(toCodeSnippet(input)).toBe('const x = 1')
  })

  it('returns fallback for non-string', () => {
    expect(toCodeSnippet(null)).toBe('// No snippet provided by Devin.')
  })

  it('returns custom fallback when no code blocks found', () => {
    expect(toCodeSnippet('no code here', 'custom')).toBe('custom')
  })
})

describe('isMergeConflictErrorMessage', () => {
  it('detects merge conflict phrases', () => {
    expect(isMergeConflictErrorMessage('merge conflict detected')).toBe(true)
    expect(isMergeConflictErrorMessage('Not Mergeable')).toBe(true)
    expect(isMergeConflictErrorMessage('this cannot be merged')).toBe(true)
    expect(isMergeConflictErrorMessage('409 Conflict')).toBe(true)
  })

  it('returns false for unrelated messages', () => {
    expect(isMergeConflictErrorMessage('success')).toBe(false)
    expect(isMergeConflictErrorMessage('')).toBe(false)
  })
})

describe('buildDevinReviewPullRequestUrl', () => {
  it('builds correct URL', () => {
    expect(buildDevinReviewPullRequestUrl('owner/repo', 42))
      .toBe('https://app.devin.ai/review/owner/repo/pull/42')
  })

  it('handles full GitHub URLs', () => {
    expect(buildDevinReviewPullRequestUrl('https://github.com/owner/repo', 1))
      .toBe('https://app.devin.ai/review/owner/repo/pull/1')
  })

  it('returns undefined for invalid repo path', () => {
    expect(buildDevinReviewPullRequestUrl('invalid', 1)).toBe(undefined)
  })
})
