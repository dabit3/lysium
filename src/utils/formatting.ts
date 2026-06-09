import { MAX_CARD_BODY_LINES, MAX_CARD_CONTEXT_SUMMARY_LINES, TERMINAL_DEVIN_STATUSES } from '../constants'
import type { DevinSessionPayload, TriageCard } from '../types'

export const isTerminalDevinStatus = (status: string | undefined): boolean =>
  typeof status === 'string' && TERMINAL_DEVIN_STATUSES.has(status)

export const formatDevinStatusLabel = (status: string): string => {
  switch (status) {
    case 'running':
      return 'Running'
    case 'suspended':
      return 'Suspended'
    case 'exit':
      return 'Exited'
    case 'error':
      return 'Error'
    case 'finished':
      return 'Finished'
    case 'stopped':
      return 'Stopped'
    case 'blocked':
      return 'Blocked'
    default:
      return status.charAt(0).toUpperCase() + status.slice(1)
  }
}

export const devinStatusToBadgeClass = (status: string): string => {
  switch (status) {
    case 'running':
      return 'badge-running'
    case 'suspended':
    case 'blocked':
      return 'badge-suspended'
    case 'exit':
    case 'finished':
    case 'stopped':
      return 'badge-exit'
    case 'error':
      return 'badge-error'
    default:
      return 'badge-default'
  }
}

export const formatRelativeTime = (createdAt: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.floor(hours / 24)}d ago`
}

export const formatFeedTimestamp = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return 'just now'
    }

    if (/\bago$/i.test(trimmed)) {
      return trimmed
    }

    const parsed = Date.parse(trimmed)
    if (!Number.isNaN(parsed)) {
      return formatRelativeTime(parsed)
    }

    return trimmed
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value
    return formatRelativeTime(milliseconds)
  }

  return 'just now'
}

export const normalizeRepoPath = (value: unknown) => {
  if (typeof value !== 'string') {
    return ''
  }

  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github\.com\//i, '')
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
}

export const normalizeSummaryLine = (line: string) =>
  line.replace(/^###\s*/, '').replace(/^-+\s*/, '').trim()

export const stripMarkdownCodeBlocks = (value: string) =>
  value.replace(/```[\s\S]*?```/g, '\n').trim()

export const formatCardContext = (card: TriageCard) => {
  const normalizedSummaryLines = stripMarkdownCodeBlocks(card.summary.join('\n'))
    .split('\n')
    .map((line) => normalizeSummaryLine(line))
    .filter((line) => line.length > 0)
  const summaryLinesForContext = normalizedSummaryLines.slice(
    0,
    MAX_CARD_CONTEXT_SUMMARY_LINES,
  )
  const normalizedSummary = summaryLinesForContext
    .map((line) => `- ${line}`)
    .join('\n')
  const omittedSummaryLineCount = Math.max(
    normalizedSummaryLines.length - summaryLinesForContext.length,
    0,
  )
  const contextSummary = normalizedSummary
    ? omittedSummaryLineCount > 0
      ? `${normalizedSummary}\n- ...${omittedSummaryLineCount} additional lines omitted for brevity.`
      : normalizedSummary
    : ''

  return [
    `Repository: ${card.repo}`,
    `${card.kind === 'issue' ? 'Issue' : 'Pull Request'}: #${card.id}`,
    `Title: ${card.title}`,
    `Author: ${card.author}`,
    contextSummary
      ? `Summary:\n${contextSummary}`
      : 'Summary: (not provided)',
    card.codeSnippet.trim().length > 0
      ? `Code Snippet:\n${card.codeSnippet}`
      : 'Code Snippet: (not provided)',
  ].join('\n\n')
}

export const toSessionIdFromSessionUrl = (sessionUrl: string | undefined) => {
  if (!sessionUrl) {
    return undefined
  }

  const match = sessionUrl.match(/\/sessions\/([^/?#]+)/i)
  if (!match || typeof match[1] !== 'string') {
    return undefined
  }

  const parsed = decodeURIComponent(match[1]).trim()
  return parsed.length > 0 ? parsed : undefined
}

export const formatSessionReference = (session: DevinSessionPayload) => {
  const sessionId =
    typeof session.session_id === 'string' ? `Session ${session.session_id}` : null
  const sessionUrl = typeof session.url === 'string' ? session.url : null

  if (sessionId && sessionUrl) {
    return `${sessionId} • ${sessionUrl}`
  }

  return sessionId ?? sessionUrl ?? 'Session started'
}

export const extractCommentBodyFromRetryPayload = (payload: string) => {
  const trimmedPayload = payload.trim()
  if (!trimmedPayload) {
    return ''
  }

  const commentBodyPrefix = 'Comment body:'
  const contextPrefix = '\n\nPull request context:'
  const commentBodyStart = trimmedPayload.indexOf(commentBodyPrefix)
  const contextStart = trimmedPayload.indexOf(contextPrefix)

  if (commentBodyStart >= 0 && contextStart > commentBodyStart) {
    const extracted = trimmedPayload
      .slice(commentBodyStart + commentBodyPrefix.length, contextStart)
      .trim()

    if (extracted.length > 0) {
      return extracted
    }
  }

  return trimmedPayload
}

export const parseAgeInMinutes = (timestamp: string) => {
  const match = timestamp.match(/(\d+)\s*([mhd])/i)
  if (!match) {
    return Number.MAX_SAFE_INTEGER
  }

  const amount = Number(match[1])
  const unit = match[2].toLowerCase()

  if (unit === 'm') return amount
  if (unit === 'h') return amount * 60
  return amount * 24 * 60
}

export const toSummaryLines = (
  value: unknown,
  fallback: string,
  maxLines = MAX_CARD_BODY_LINES,
) => {
  if (Array.isArray(value)) {
    const lines = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
      .slice(0, maxLines)

    if (lines.length > 0) {
      return lines
    }
  }

  if (typeof value === 'string') {
    const lines = value
      .split('\n')
      .map((entry) => entry.replace(/\r$/, ''))
      .slice(0, maxLines)

    if (lines.some((entry) => entry.trim().length > 0)) {
      return lines
    }
  }

  return [fallback]
}

export const toCodeSnippet = (value: unknown, fallback = '// No snippet provided by Devin.') => {
  if (typeof value !== 'string') {
    return fallback
  }

  const codeBlockMatches = value.matchAll(/```(?:[\w.+-]+)?\n?([\s\S]*?)```/g)
  for (const codeBlockMatch of codeBlockMatches) {
    const snippet = (codeBlockMatch[1] ?? '')
      .split('\n')
      .slice(0, 14)
      .join('\n')
      .trim()

    if (snippet.length > 0) {
      return snippet
    }
  }

  return fallback
}

export const isMergeConflictErrorMessage = (message: string) => {
  const normalizedMessage = message.trim().toLowerCase()
  if (!normalizedMessage) {
    return false
  }

  return (
    normalizedMessage.includes('merge conflict') ||
    normalizedMessage.includes('not mergeable') ||
    normalizedMessage.includes('cannot be merged') ||
    normalizedMessage.includes('409 conflict')
  )
}

export const buildDevinReviewPullRequestUrl = (repoPath: string, pullNumber: number) => {
  const normalizedRepoPath = normalizeRepoPath(repoPath)
  const [owner, repo] = normalizedRepoPath.split('/')
  if (!owner || !repo || !Number.isFinite(pullNumber)) {
    return undefined
  }

  return `https://app.devin.ai/review/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${Math.trunc(pullNumber)}`
}
