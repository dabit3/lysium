import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import './App.css'

import {
  X,
  Check,
  Settings,
  Activity,
  ArrowDown,
  MessageSquarePlus,
  Play,
  Rocket,
  RefreshCw,
  Github,
  Plus,
  List,
  CheckSquare,
  Square,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { Transition } from 'framer-motion'

type TabKey = 'issues' | 'pullRequests' | 'code'
type SwipeDirection = 'left' | 'right' | 'down'

interface BaseCard {
  id: number
  repo: string
  author: string
  avatarUrl: string
  timestamp: string
  title: string
  summary: string[]
  codeSnippet: string
}

interface IssueCard extends BaseCard {
  kind: 'issue'
  labels: string[]
}

interface PullRequestCard extends BaseCard {
  kind: 'pullRequest'
  additions: number
  deletions: number
  checks: Array<{ label: string; passed: boolean }>
  autoMergePermissionRace?: boolean
}

interface SwipeAction {
  label: string
  icon: React.ReactNode
  tone: 'neutral' | 'accent' | 'highlight' | 'danger'
}

type TriageCard = IssueCard | PullRequestCard

interface JobEntry {
  id: number
  label: string
  target: string
  status: 'running' | 'success' | 'failed'
  message: string
  retryable: boolean
  retryPrompt?: string
  sessionUrl?: string
  pullRequestUrl?: string
  createdAt: number
  devinStatus?: string
  statusDetail?: string
}


interface AssessedIssueEntry {
  assessedAt: number
  sessionUrl?: string
  sessionId?: string
}

interface PullRequestCodeEntry {
  status: 'loading' | 'ready' | 'failed'
  lines: string[]
}

interface DevinSessionPayload {
  session_id?: string
  url?: string
  status?: string
  status_detail?: string | null
  structured_output?: unknown
  [key: string]: unknown
}

const TERMINAL_DEVIN_STATUSES = new Set(['finished', 'stopped', 'exit', 'error'])

const isTerminalDevinStatus = (status: string | undefined): boolean =>
  typeof status === 'string' && TERMINAL_DEVIN_STATUSES.has(status)

const formatDevinStatusLabel = (status: string): string => {
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

const devinStatusToBadgeClass = (status: string): string => {
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

interface GithubSearchUser {
  login?: string
  avatar_url?: string
}

interface GithubSearchItem {
  number?: number
  title?: string
  body?: string | null
  repository_url?: string
  html_url?: string
  updated_at?: string
  created_at?: string
  user?: GithubSearchUser | null
  labels?: Array<string | { name?: string }>
}

interface GithubSearchResponse {
  items?: GithubSearchItem[]
}

interface GithubPullRequestDetailsResponse {
  mergeable?: boolean | null
  mergeable_state?: string | null
}

interface GithubPullRequestFile {
  filename?: string
  status?: string
  patch?: string
  additions?: number
  deletions?: number
}

const normalizeGithubScopeQualifier = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  if (trimmed.includes(':')) {
    return trimmed
  }

  return `org:${trimmed}`
}

const getRepoPathFromGithubSearchItem = (item: GithubSearchItem) => {
  if (typeof item.repository_url === 'string') {
    const apiRepoMatch = item.repository_url.match(/\/repos\/([^/]+\/[^/]+)$/i)
    if (apiRepoMatch) {
      return normalizeRepoPath(apiRepoMatch[1])
    }
  }

  if (typeof item.html_url === 'string') {
    const htmlRepoMatch = item.html_url.match(/github\.com\/([^/]+\/[^/]+)/i)
    if (htmlRepoMatch) {
      return normalizeRepoPath(htmlRepoMatch[1])
    }
  }

  return ''
}

const normalizeGithubLabels = (labels: GithubSearchItem['labels']) => {
  if (!Array.isArray(labels)) {
    return [] as string[]
  }

  return labels
    .map((label) => {
      if (typeof label === 'string') {
        return label.trim()
      }

      if (label && typeof label === 'object' && typeof label.name === 'string') {
        return label.name.trim()
      }

      return ''
    })
    .filter((label) => label.length > 0)
    .slice(0, 6)
}

const extractGithubOauthToken = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const candidate = payload as Record<string, unknown>
  const tokenCandidate =
    typeof candidate.access_token === 'string'
      ? candidate.access_token
      : typeof candidate.accessToken === 'string'
        ? candidate.accessToken
        : typeof candidate.token === 'string'
          ? candidate.token
          : ''

  return tokenCandidate.trim()
}

const extractGithubOauthLogin = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.login === 'string' && candidate.login.trim().length > 0) {
    return candidate.login.trim()
  }

  if (typeof candidate.username === 'string' && candidate.username.trim().length > 0) {
    return candidate.username.trim()
  }

  if (candidate.user && typeof candidate.user === 'object') {
    const user = candidate.user as Record<string, unknown>
    if (typeof user.login === 'string' && user.login.trim().length > 0) {
      return user.login.trim()
    }
  }

  return null
}

const DEVIN_PROXY_BASE_URL = '/api/devin/proxy'
const DEVIN_SESSION_URL = '/api/devin/session'
const DEFAULT_DEVIN_API_KEY =
  typeof import.meta.env.VITE_DEVIN_API_KEY === 'string'
    ? import.meta.env.VITE_DEVIN_API_KEY.trim()
    : ''
const DEFAULT_DEVIN_ORG_ID =
  typeof import.meta.env.VITE_DEVIN_ORG_ID === 'string'
    ? import.meta.env.VITE_DEVIN_ORG_ID.trim()
    : ''
const GITHUB_OAUTH_START_URL = '/api/github/oauth/start'
const GITHUB_OAUTH_TOKEN_URL = '/api/github/oauth/token'
const GITHUB_OAUTH_DISCONNECT_URL = '/api/github/oauth/disconnect'
const HAS_GITHUB_OAUTH_CONFIG = true
const MAX_CARD_BODY_LINES = 120
const MAX_CARD_CONTEXT_SUMMARY_LINES = 24
const DESKTOP_LAYOUT_MEDIA_QUERY = '(min-width: 1000px)'
const DESKTOP_WIDE_LAYOUT_MEDIA_QUERY = '(min-width: 1300px)'

const ASSESSED_ISSUES_STORAGE_KEY = 'minion.assessed_issues.v1'
const ASSESSED_PRS_STORAGE_KEY = 'minion.assessed_prs.v1'
const GITHUB_SCOPE_STORAGE_KEY = 'minion.github_scope.v1'
const DEVINS_MACHINE_REPO_LABEL = "Devin's machine"
const DEVIN_GITHUB_COMMENT_MENTION = '@devin-ai-integration'
const JOBS_STORAGE_KEY = 'minion.jobs.v1'

const loadPersistedJobs = (): JobEntry[] => {
  try {
    const raw = window.localStorage.getItem(JOBS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as JobEntry[]) : []
  } catch {
    return []
  }
}

const savePersistedJobs = (jobs: JobEntry[]) => {
  try {
    window.localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(jobs))
  } catch {
    return
  }
}
const DevinLogo = ({ size = 16 }: { size?: number }) => (
  <img src="/devin.png" alt="" aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
)
const ASSESSED_ISSUES_RETENTION_MS = 1000 * 60 * 60 * 24 * 90

const normalizeSummaryLine = (line: string) =>
  line.replace(/^###\s*/, '').replace(/^-+\s*/, '').trim()

const stripMarkdownCodeBlocks = (value: string) =>
  value.replace(/```[\s\S]*?```/g, '\n').trim()

const formatCardContext = (card: TriageCard) => {
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

const toSessionIdFromSessionUrl = (sessionUrl: string | undefined) => {
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

const formatSessionReference = (session: DevinSessionPayload) => {
  const sessionId =
    typeof session.session_id === 'string' ? `Session ${session.session_id}` : null
  const sessionUrl = typeof session.url === 'string' ? session.url : null

  if (sessionId && sessionUrl) {
    return `${sessionId} • ${sessionUrl}`
  }

  return sessionId ?? sessionUrl ?? 'Session started'
}

const extractCommentBodyFromRetryPayload = (payload: string) => {
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

const parseAgeInMinutes = (timestamp: string) => {
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

const roundRobinByRepo = <T extends BaseCard>(cards: T[]) => {
  const grouped = new Map<string, T[]>()

  cards.forEach((card) => {
    const list = grouped.get(card.repo)
    if (list) {
      list.push(card)
    } else {
      grouped.set(card.repo, [card])
    }
  })

  grouped.forEach((repoCards) => {
    repoCards.sort(
      (a, b) => parseAgeInMinutes(a.timestamp) - parseAgeInMinutes(b.timestamp),
    )
  })

  const repoOrder = Array.from(grouped.keys()).sort((left, right) => {
    const leftHead = grouped.get(left)?.[0]
    const rightHead = grouped.get(right)?.[0]
    return (
      parseAgeInMinutes(leftHead?.timestamp ?? '999d') -
      parseAgeInMinutes(rightHead?.timestamp ?? '999d')
    )
  })

  const ordered: T[] = []
  let added = true

  while (added) {
    added = false
    repoOrder.forEach((repo) => {
      const repoCards = grouped.get(repo)
      const nextCard = repoCards?.shift()
      if (nextCard) {
        ordered.push(nextCard)
        added = true
      }
    })
  }

  return ordered
}

const formatRelativeTime = (createdAt: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.floor(hours / 24)}d ago`
}

const normalizeRepoPath = (value: unknown) => {
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

const toIssueAssessmentKey = (issue: Pick<IssueCard, 'repo' | 'id'>) => {
  const repo = normalizeRepoPath(issue.repo).toLowerCase()
  const id = Number(issue.id)
  if (!repo || !Number.isFinite(id)) {
    return ''
  }

  return `${repo}#${Math.trunc(id)}`
}

const parseRepoAndIssueNumberFromJobTarget = (target: string) => {
  const match = target.trim().match(/^(.+?)\s+#(\d+)$/)
  if (!match) {
    return null
  }

  const repo = normalizeRepoPath(match[1])
  const id = Number(match[2])
  if (!repo || !Number.isFinite(id)) {
    return null
  }

  return { repo, id: Math.trunc(id) }
}

const toIssueAssessmentKeyFromJobTarget = (target: string) => {
  const parsed = parseRepoAndIssueNumberFromJobTarget(target)
  if (!parsed) {
    return ''
  }

  return toIssueAssessmentKey(parsed)
}

const toAssessedIssueEntry = (value: unknown): AssessedIssueEntry | null => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null
    }

    return { assessedAt: value }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as {
    assessedAt?: unknown
    timestamp?: unknown
    sessionUrl?: unknown
    sessionId?: unknown
    session_id?: unknown
  }

  const rawTimestamp =
    candidate.assessedAt !== undefined ? candidate.assessedAt : candidate.timestamp
  const assessedAt = Number(rawTimestamp)
  if (!Number.isFinite(assessedAt)) {
    return null
  }

  const normalizedSessionUrl =
    typeof candidate.sessionUrl === 'string' && candidate.sessionUrl.trim().length > 0
      ? candidate.sessionUrl.trim()
      : undefined
  const normalizedSessionId =
    (typeof candidate.sessionId === 'string' && candidate.sessionId.trim().length > 0
      ? candidate.sessionId.trim()
      : undefined) ??
    (typeof candidate.session_id === 'string' && candidate.session_id.trim().length > 0
      ? candidate.session_id.trim()
      : undefined) ??
    toSessionIdFromSessionUrl(normalizedSessionUrl)

  return {
    assessedAt,
    sessionUrl: normalizedSessionUrl,
    sessionId: normalizedSessionId,
  }
}

const loadAssessedIssueLookup = () => {
  if (typeof window === 'undefined') {
    return {} as Record<string, AssessedIssueEntry>
  }

  try {
    const raw = window.localStorage.getItem(ASSESSED_ISSUES_STORAGE_KEY)
    if (!raw) {
      return {} as Record<string, AssessedIssueEntry>
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {} as Record<string, AssessedIssueEntry>
    }

    const now = Date.now()
    return Object.entries(parsed).reduce<Record<string, AssessedIssueEntry>>((lookup, entry) => {
      const [key, value] = entry
      const normalizedKey = key.trim().toLowerCase()
      const assessmentEntry = toAssessedIssueEntry(value)
      if (!normalizedKey || !assessmentEntry) {
        return lookup
      }

      if (now - assessmentEntry.assessedAt > ASSESSED_ISSUES_RETENTION_MS) {
        return lookup
      }

      lookup[normalizedKey] = assessmentEntry
      return lookup
    }, {})
  } catch {
    return {} as Record<string, AssessedIssueEntry>
  }
}

const loadAssessedPrLookup = () => {
  if (typeof window === 'undefined') {
    return {} as Record<string, AssessedIssueEntry>
  }

  try {
    const raw = window.localStorage.getItem(ASSESSED_PRS_STORAGE_KEY)
    if (!raw) {
      return {} as Record<string, AssessedIssueEntry>
    }

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {} as Record<string, AssessedIssueEntry>
    }

    const now = Date.now()
    return Object.entries(parsed).reduce<Record<string, AssessedIssueEntry>>((lookup, entry) => {
      const [key, value] = entry
      const normalizedKey = key.trim().toLowerCase()
      const assessmentEntry = toAssessedIssueEntry(value)
      if (!normalizedKey || !assessmentEntry) {
        return lookup
      }

      if (now - assessmentEntry.assessedAt > ASSESSED_ISSUES_RETENTION_MS) {
        return lookup
      }

      lookup[normalizedKey] = assessmentEntry
      return lookup
    }, {})
  } catch {
    return {} as Record<string, AssessedIssueEntry>
  }
}

const loadGithubSearchScope = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    const raw = window.localStorage.getItem(GITHUB_SCOPE_STORAGE_KEY)
    return typeof raw === 'string' ? raw : ''
  } catch {
    return ''
  }
}

const findLatestIssueAssessmentSessionUrl = (
  jobs: JobEntry[],
  issueAssessmentKey: string,
) => {
  for (const job of jobs) {
    if (
      job.label === 'Assess Necessity' &&
      job.status === 'success' &&
      job.sessionUrl
    ) {
      const jobIssueAssessmentKey = toIssueAssessmentKeyFromJobTarget(job.target)
      if (jobIssueAssessmentKey === issueAssessmentKey) {
        return job.sessionUrl
      }
    }
  }

  return undefined
}

const findLatestPullRequestAssessmentSessionUrl = (
  jobs: JobEntry[],
  pullRequestAssessmentKey: string,
) => {
  for (const job of jobs) {
    if (
      job.label === 'Assess Merge Decision' &&
      job.status === 'success' &&
      job.sessionUrl
    ) {
      const jobPullRequestAssessmentKey = toIssueAssessmentKeyFromJobTarget(job.target)
      if (jobPullRequestAssessmentKey === pullRequestAssessmentKey) {
        return job.sessionUrl
      }
    }
  }

  return undefined
}

const buildDevinReviewPullRequestUrl = (repoPath: string, pullNumber: number) => {
  const normalizedRepoPath = normalizeRepoPath(repoPath)
  const [owner, repo] = normalizedRepoPath.split('/')
  if (!owner || !repo || !Number.isFinite(pullNumber)) {
    return undefined
  }

  return `https://app.devin.ai/review/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${Math.trunc(pullNumber)}`
}

const isMergeConflictErrorMessage = (message: string) => {
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

const detectGithubPullRequestMergeConflict = async (
  repoPath: string,
  pullNumber: number,
  githubTokenValue: string,
) => {
  const token = githubTokenValue.trim()
  if (!token) {
    throw new Error('Missing GitHub OAuth token.')
  }

  const normalizedRepoPath = normalizeRepoPath(repoPath)
  const [owner, repo] = normalizedRepoPath.split('/')
  if (!owner || !repo) {
    throw new Error(`Invalid repository path: ${repoPath}`)
  }

  const readPullRequestDetails = async () => {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`.trim())
    }

    return (await response.json()) as GithubPullRequestDetailsResponse
  }

  let payload = await readPullRequestDetails()

  if (payload.mergeable === null) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 220)
    })
    payload = await readPullRequestDetails()
  }

  const mergeableState =
    typeof payload.mergeable_state === 'string'
      ? payload.mergeable_state.trim().toLowerCase()
      : ''

  if (mergeableState === 'dirty') {
    return true
  }

  return payload.mergeable === false && mergeableState !== 'unknown'
}

const formatFeedTimestamp = (value: unknown) => {
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

const toSummaryLines = (
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

const toCodeSnippet = (value: unknown, fallback = '// No snippet provided by Devin.') => {
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

type CodeTokenTone =
  | 'plain'
  | 'comment'
  | 'string'
  | 'keyword'
  | 'number'
  | 'literal'
  | 'property'
  | 'variable'
  | 'diffAdd'
  | 'diffRemove'
  | 'diffMeta'

interface CodeToken {
  value: string
  tone: CodeTokenTone
}

const normalizeCodeFenceLanguage = (value: string) => {
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return ''
  }

  if (normalized === 'ts' || normalized === 'tsx') {
    return 'typescript'
  }

  if (normalized === 'js' || normalized === 'jsx' || normalized === 'mjs') {
    return 'javascript'
  }

  if (normalized === 'sh' || normalized === 'zsh' || normalized === 'shell') {
    return 'bash'
  }

  if (normalized === 'py') {
    return 'python'
  }

  if (normalized === 'yml') {
    return 'yaml'
  }

  return normalized
}

const parseCodeFenceLanguage = (line: string) => {
  const languageHint = line.replace(/^```+/, '').trim().split(/\s+/)[0] ?? ''
  return normalizeCodeFenceLanguage(languageHint)
}

const tokenizeWithPattern = (
  source: string,
  pattern: RegExp,
  classify: (value: string, index: number, sourceValue: string) => CodeTokenTone,
) => {
  const tokens: CodeToken[] = []
  let cursor = 0

  for (const match of source.matchAll(pattern)) {
    const value = match[0]
    const index = typeof match.index === 'number' ? match.index : -1

    if (index < 0) {
      continue
    }

    if (index > cursor) {
      tokens.push({ value: source.slice(cursor, index), tone: 'plain' })
    }

    tokens.push({ value, tone: classify(value, index, source) })
    cursor = index + value.length
  }

  if (cursor < source.length) {
    tokens.push({ value: source.slice(cursor), tone: 'plain' })
  }

  return tokens
}

const JS_LIKE_HIGHLIGHT_PATTERN =
  /\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|extends|new|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|interface|type|implements|public|private|protected|readonly|enum)\b|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b/gm

const PYTHON_HIGHLIGHT_PATTERN =
  /#.*$|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|lambda|yield|async|await|pass|break|continue|raise|in|is|not|and|or|None|True|False)\b|\b\d+(?:\.\d+)?\b/gm

const BASH_HIGHLIGHT_PATTERN =
  /#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|\b(?:if|then|fi|for|in|do|done|case|esac|function|export|local|readonly|echo|source|return|while)\b|\b\d+\b/gm

const JSON_HIGHLIGHT_PATTERN =
  /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/gm

const YAML_HIGHLIGHT_PATTERN =
  /^\s*#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null|yes|no|on|off)\b|-?\b\d+(?:\.\d+)?\b/gm

const GENERIC_HIGHLIGHT_PATTERN =
  /#.*$|\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b/gm

const highlightCodeTokens = (source: string, language: string) => {
  const normalizedLanguage = normalizeCodeFenceLanguage(language)

  if (normalizedLanguage === 'javascript' || normalizedLanguage === 'typescript') {
    return tokenizeWithPattern(source, JS_LIKE_HIGHLIGHT_PATTERN, (value) => {
      if (value.startsWith('//') || value.startsWith('/*')) {
        return 'comment'
      }

      if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) {
        return 'string'
      }

      if (/^(true|false|null|undefined)$/.test(value)) {
        return 'literal'
      }

      if (/^\d/.test(value)) {
        return 'number'
      }

      return 'keyword'
    })
  }

  if (normalizedLanguage === 'python') {
    return tokenizeWithPattern(source, PYTHON_HIGHLIGHT_PATTERN, (value) => {
      if (value.startsWith('#')) {
        return 'comment'
      }

      if (
        value.startsWith('"') ||
        value.startsWith("'") ||
        value.startsWith('"""') ||
        value.startsWith("'''")
      ) {
        return 'string'
      }

      if (/^(None|True|False)$/.test(value)) {
        return 'literal'
      }

      if (/^\d/.test(value)) {
        return 'number'
      }

      return 'keyword'
    })
  }

  if (normalizedLanguage === 'bash') {
    return tokenizeWithPattern(source, BASH_HIGHLIGHT_PATTERN, (value) => {
      if (value.startsWith('#')) {
        return 'comment'
      }

      if (value.startsWith('"') || value.startsWith("'")) {
        return 'string'
      }

      if (value.startsWith('$')) {
        return 'variable'
      }

      if (/^\d/.test(value)) {
        return 'number'
      }

      return 'keyword'
    })
  }

  if (normalizedLanguage === 'json') {
    return tokenizeWithPattern(source, JSON_HIGHLIGHT_PATTERN, (value, index, sourceValue) => {
      if (/^-?\d/.test(value)) {
        return 'number'
      }

      if (/^(true|false|null)$/.test(value)) {
        return 'literal'
      }

      const remainder = sourceValue.slice(index + value.length).trimStart()
      return remainder.startsWith(':') ? 'property' : 'string'
    })
  }

  if (normalizedLanguage === 'yaml') {
    return tokenizeWithPattern(source, YAML_HIGHLIGHT_PATTERN, (value) => {
      if (value.trimStart().startsWith('#')) {
        return 'comment'
      }

      if (/^-?\d/.test(value)) {
        return 'number'
      }

      if (/^(true|false|null|yes|no|on|off)$/i.test(value)) {
        return 'literal'
      }

      return 'string'
    })
  }

  if (normalizedLanguage === 'diff') {
    const lines = source.split('\n')
    return lines.map((line, index) => {
      const lineWithBreak = index < lines.length - 1 ? `${line}\n` : line
      const isAddedLine = line.startsWith('+') && !line.startsWith('+++')
      const isRemovedLine = line.startsWith('-') && !line.startsWith('---')
      const isMetaLine =
        line.startsWith('@@') ||
        line.startsWith('diff ') ||
        line.startsWith('index ') ||
        line.startsWith('---') ||
        line.startsWith('+++')

      return {
        value: lineWithBreak,
        tone: isAddedLine
          ? 'diffAdd'
          : isRemovedLine
            ? 'diffRemove'
            : isMetaLine
              ? 'diffMeta'
              : 'plain',
      }
    })
  }

  return tokenizeWithPattern(source, GENERIC_HIGHLIGHT_PATTERN, (value) => {
    if (value.startsWith('#') || value.startsWith('//') || value.startsWith('/*')) {
      return 'comment'
    }

    if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) {
      return 'string'
    }

    if (/^\d/.test(value)) {
      return 'number'
    }

    return 'plain'
  })
}

type CardMarkdownBlock =
  | { kind: 'heading' | 'bullet' | 'paragraph'; content: string }
  | { kind: 'code'; content: string; language: string }

const buildCardMarkdownBlocks = (lines: string[]): CardMarkdownBlock[] => {
  const blocks: CardMarkdownBlock[] = []
  let isInCodeFence = false
  let codeFenceLines: string[] = []
  let codeFenceLanguage = ''

  lines.forEach((line) => {
    const normalizedLine = line.replace(/\r$/, '')
    const trimmedLine = normalizedLine.trim()

    if (/^```/.test(trimmedLine)) {
      if (isInCodeFence) {
        const codeContent = codeFenceLines.join('\n').trimEnd()
        if (codeContent.length > 0) {
          blocks.push({
            kind: 'code',
            content: codeContent,
            language: codeFenceLanguage,
          })
        }
        codeFenceLines = []
        codeFenceLanguage = ''
        isInCodeFence = false
      } else {
        isInCodeFence = true
        codeFenceLines = []
        codeFenceLanguage = parseCodeFenceLanguage(trimmedLine)
      }
      return
    }

    if (isInCodeFence) {
      codeFenceLines.push(normalizedLine)
      return
    }

    if (!trimmedLine) {
      return
    }

    if (/^#{1,6}\s+/.test(trimmedLine)) {
      blocks.push({
        kind: 'heading',
        content: trimmedLine.replace(/^#{1,6}\s+/, ''),
      })
      return
    }

    if (/^[-*]\s+/.test(trimmedLine)) {
      blocks.push({
        kind: 'bullet',
        content: trimmedLine.replace(/^[-*]\s+/, ''),
      })
      return
    }

    blocks.push({ kind: 'paragraph', content: trimmedLine })
  })

  if (codeFenceLines.length > 0) {
    const codeContent = codeFenceLines.join('\n').trimEnd()
    if (codeContent.length > 0) {
      blocks.push({
        kind: 'code',
        content: codeContent,
        language: codeFenceLanguage,
      })
    }
  }

  return blocks
}

const toPullRequestCodeLines = (files: GithubPullRequestFile[], pullNumber: number) => {
  if (files.length === 0) {
    return [`No changed files were returned for pull request #${pullNumber}.`]
  }

  const lines: string[] = []

  files.forEach((file, index) => {
    const filename =
      typeof file.filename === 'string' && file.filename.trim().length > 0
        ? file.filename.trim()
        : `file-${index + 1}`
    const status =
      typeof file.status === 'string' && file.status.trim().length > 0
        ? file.status.trim()
        : 'modified'
    const additions = Number(file.additions)
    const deletions = Number(file.deletions)
    const hasDiffStats = Number.isFinite(additions) && Number.isFinite(deletions)
    const patch = typeof file.patch === 'string' ? file.patch.trimEnd() : ''

    lines.push(`### ${filename}`)
    lines.push(`- status: ${status}`)

    if (hasDiffStats) {
      lines.push(`- diff stats: +${additions} / -${deletions}`)
    }

    if (patch.length > 0) {
      lines.push('```diff')
      lines.push(patch)
      lines.push('```')
    } else {
      lines.push('- diff: (patch unavailable, likely binary or too large)')
    }

    if (index < files.length - 1) {
      lines.push('')
    }
  })

  return lines
}

const mapIssueFromGithubSearchItem = (item: GithubSearchItem): IssueCard | null => {
  const id = Number(item.number)
  if (!Number.isFinite(id)) {
    return null
  }

  const repo = getRepoPathFromGithubSearchItem(item)
  if (!repo) {
    return null
  }

  const author =
    (typeof item.user?.login === 'string' && item.user.login.trim()) ||
    'Unknown author'
  const avatarUrl =
    (typeof item.user?.avatar_url === 'string' && item.user.avatar_url.trim()) ||
    'https://avatars.githubusercontent.com/u/0?v=4'

  return {
    kind: 'issue',
    id,
    repo,
    author,
    avatarUrl,
    timestamp: formatFeedTimestamp(item.updated_at ?? item.created_at),
    title: (typeof item.title === 'string' && item.title.trim()) || `Issue #${id}`,
    summary: toSummaryLines(item.body, `Imported from GitHub issue #${id}.`),
    codeSnippet: toCodeSnippet(item.body, ''),
    labels: normalizeGithubLabels(item.labels),
  }
}

const mapPullRequestFromGithubSearchItem = (
  item: GithubSearchItem,
): PullRequestCard | null => {
  const id = Number(item.number)
  if (!Number.isFinite(id)) {
    return null
  }

  const repo = getRepoPathFromGithubSearchItem(item)
  if (!repo) {
    return null
  }

  const author =
    (typeof item.user?.login === 'string' && item.user.login.trim()) ||
    'Unknown author'
  const avatarUrl =
    (typeof item.user?.avatar_url === 'string' && item.user.avatar_url.trim()) ||
    'https://avatars.githubusercontent.com/u/0?v=4'

  return {
    kind: 'pullRequest',
    id,
    repo,
    author,
    avatarUrl,
    timestamp: formatFeedTimestamp(item.updated_at ?? item.created_at),
    title: (typeof item.title === 'string' && item.title.trim()) || `PR #${id}`,
    summary: toSummaryLines(item.body, `Imported from GitHub pull request #${id}.`),
    codeSnippet: toCodeSnippet(item.body, ''),
    additions: 0,
    deletions: 0,
    checks: [],
  }
}

const getSwipeAction = (tab: TabKey, direction: SwipeDirection): SwipeAction => {
  if (direction === 'down') {
    return { label: 'Skip / Ignore', icon: <ArrowDown size={18} />, tone: 'neutral' }
  }

  if (tab === 'issues') {
    return direction === 'left'
      ? { label: 'Close Issue', icon: <X size={18} />, tone: 'danger' }
      : { label: 'Create PR', icon: <DevinLogo size={18} />, tone: 'accent' }
  }

  return direction === 'left'
    ? { label: 'Close PR', icon: <X size={18} />, tone: 'danger' }
    : { label: 'Merge PR', icon: <Check size={18} />, tone: 'highlight' }
}

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

const getSwipeToast = (
  tab: TabKey,
  direction: SwipeDirection,
  card: TriageCard,
) => {
  if (direction === 'down') {
    return card.kind === 'issue'
      ? `Skipping issue #${card.id}...`
      : `Skipping PR #${card.id}...`
  }

  if (tab === 'issues') {
    return direction === 'left'
      ? `Closing issue #${card.id} on GitHub...`
      : 'Devin initializing PR...'
  }

  if (direction === 'right') {
    const hasBlockingChecks =
      card.kind === 'pullRequest' && card.checks.some((check) => !check.passed)

    if (hasBlockingChecks) {
      return `Checks pending on PR #${card.id}. Trying auto-merge enrollment...`
    }

    return `PR #${card.id} merged.`
  }

  return `PR #${card.id} closed without merge.`
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('code')
  const [issues, setIssues] = useState<IssueCard[]>([])
  const [pullRequests, setPullRequests] = useState<PullRequestCard[]>([])

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isAnimatingOut, setIsAnimatingOut] = useState(false)
  const [swipeDirection, setSwipeDirection] = useState<SwipeDirection | null>(
    null,
  )
  const [swipeExitDurationMs, setSwipeExitDurationMs] = useState(210)
  const [isDesktopButtonSwipe, setIsDesktopButtonSwipe] = useState(false)

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastUndoCallback, setToastUndoCallback] = useState<(() => void) | null>(null)
  const [isAssessingIssue, setIsAssessingIssue] = useState(false)
  const [isAssessingPullRequest, setIsAssessingPullRequest] = useState(false)
  const [isFixingMergeConflict, setIsFixingMergeConflict] = useState(false)
  const [isMergingResolvedConflict, setIsMergingResolvedConflict] = useState(false)
  const [isCommentModalOpen, setIsCommentModalOpen] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [isPostingComment, setIsPostingComment] = useState(false)
  const [isCreateIssueModalOpen, setIsCreateIssueModalOpen] = useState(false)
  const [createIssueRepo, setCreateIssueRepo] = useState('')
  const [createIssueRepoQuery, setCreateIssueRepoQuery] = useState('')
  const [createIssueTitle, setCreateIssueTitle] = useState('')
  const [createIssueBody, setCreateIssueBody] = useState('')
  const [isCreatingIssue, setIsCreatingIssue] = useState(false)
  const [jobs, setJobs] = useState<JobEntry[]>(() => loadPersistedJobs())
  const [isJobsOpen, setIsJobsOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDesktopLayout, setIsDesktopLayout] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY).matches,
  )
  const [isDesktopWideLayout, setIsDesktopWideLayout] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(DESKTOP_WIDE_LAYOUT_MEDIA_QUERY).matches,
  )
  const [isDesktopActivityOpen, setIsDesktopActivityOpen] = useState(false)
  const [startupIntroPhase, setStartupIntroPhase] = useState<'idle' | 'playing' | 'done'>('idle')
  const [startupIntroCycle, setStartupIntroCycle] = useState(0)
    const [colorTheme, setColorTheme] = useState<'dark' | 'light' | 'aurora' | 'matrix'>(
      () =>
        (localStorage.getItem('minion.theme') as 'dark' | 'light' | 'aurora' | 'matrix') ??
        'light',
    )
  const [devinApiKey, setDevinApiKey] = useState(DEFAULT_DEVIN_API_KEY)
  const [devinOrgId, setDevinOrgId] = useState(DEFAULT_DEVIN_ORG_ID)
  const [devinCreateAsUserId, setDevinCreateAsUserId] = useState('')
  const [isLoadingDevinSession, setIsLoadingDevinSession] = useState(true)
  const [hasDevinSession, setHasDevinSession] = useState(false)
  const [hasGithubOauthSession, setHasGithubOauthSession] = useState(false)
  const [isCheckingGithubOauthSession, setIsCheckingGithubOauthSession] = useState(true)
  const [githubOauthLogin, setGithubOauthLogin] = useState<string | null>(null)
  const [isDisconnectingGithubOauthSession, setIsDisconnectingGithubOauthSession] =
    useState(false)
  const [isClearingSession, setIsClearingSession] = useState(false)
  const [githubSearchScope, setGithubSearchScope] = useState(() => loadGithubSearchScope())
  const [isVerifyingDevinConnection, setIsVerifyingDevinConnection] =
    useState(false)
  const [hasVerifiedDevinConnection, setHasVerifiedDevinConnection] =
    useState(false)
  const [isSyncingGithubFeed, setIsSyncingGithubFeed] = useState(false)
  const [, setLastGithubSyncSummary] = useState<string | null>(null)
  const [hasSyncedGithubFeed, setHasSyncedGithubFeed] = useState(false)
  const [pullRequestContentView, setPullRequestContentView] = useState<'summary' | 'code'>(
    'summary',
  )
  const [pullRequestCodeLookup, setPullRequestCodeLookup] = useState<
    Record<string, PullRequestCodeEntry>
  >({})
  const [selectedRepo, setSelectedRepo] = useState(DEVINS_MACHINE_REPO_LABEL)
  const [repoFilterQuery, setRepoFilterQuery] = useState('')
  const [repoRequestPrompt, setRepoRequestPrompt] = useState('')
  const [isCreatingRepoRequest, setIsCreatingRepoRequest] = useState(false)
  const [shipLaunchCount, setShipLaunchCount] = useState(0)
  const [assessedIssueLookup, setAssessedIssueLookup] = useState<
    Record<string, AssessedIssueEntry>
  >(() => loadAssessedIssueLookup())
  const [assessedPrLookup, setAssessedPrLookup] = useState<
    Record<string, AssessedIssueEntry>
  >(() => loadAssessedPrLookup())
  const [mergeConflictLookup, setMergeConflictLookup] = useState<Record<string, number>>(
    {},
  )
  const [mergeConflictCheckLookup, setMergeConflictCheckLookup] = useState<
    Record<string, number>
  >({})
  const [mergeConflictResolutionLookup, setMergeConflictResolutionLookup] = useState<
    Record<string, 'running' | 'resolved'>
  >({})
  const [isBulkMode, setIsBulkMode] = useState(false)
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<Set<string>>(new Set())
  const [isBulkActionRunning, setIsBulkActionRunning] = useState(false)
  const pointerIdRef = useRef<number | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const dragVelocityRef = useRef(0)
  const dragVerticalVelocityRef = useRef(0)
  const dragLastSampleRef = useRef({ x: 0, y: 0, time: 0 })
  const toastTimeoutRef = useRef<number | null>(null)
  const pendingUndoRef = useRef<{ timeoutId: number; cancelled: boolean } | null>(null)
  const commitSwipeRef = useRef<(direction: SwipeDirection) => void>(() => {})
  const nextJobIdRef = useRef(
    (() => {
      const persisted = loadPersistedJobs()
      return persisted.length > 0 ? Math.max(...persisted.map((j) => j.id)) + 1 : 1
    })()
  )
  const nextActionIdRef = useRef(1)
  // Action tracking kept as no-ops; UI only shows session activity now.
  const mergeConflictPollingLookupRef = useRef<Record<string, true>>({})
  const syncGithubFeedRef = useRef<
    ((options?: { autoTriggered?: boolean }) => Promise<void>) | null
  >(null)
  const hasAttemptedStartupSyncRef = useRef(false)
  const prefersReducedMotion = useReducedMotion()

  const activeDeck =
    activeTab === 'issues' ? issues : activeTab === 'pullRequests' ? pullRequests : []
  const topCard = activeDeck[0]
  const visibleCards = activeDeck.slice(0, 3)
  const availableRepos = useMemo(() => {
    const repoSet = new Set<string>()

    issues.forEach((issue) => {
      const normalizedRepo = normalizeRepoPath(issue.repo)
      if (normalizedRepo) {
        repoSet.add(normalizedRepo)
      }
    })

    pullRequests.forEach((pullRequest) => {
      const normalizedRepo = normalizeRepoPath(pullRequest.repo)
      if (normalizedRepo) {
        repoSet.add(normalizedRepo)
      }
    })

    return Array.from(repoSet).sort((left, right) => left.localeCompare(right))
  }, [issues, pullRequests])
  const repoOptions = useMemo(
    () => [DEVINS_MACHINE_REPO_LABEL, ...availableRepos],
    [availableRepos],
  )
  const filteredRepoOptions = useMemo(() => {
    const normalizedFilter = repoFilterQuery.trim().toLowerCase()
    if (!normalizedFilter) {
      return repoOptions
    }

    return repoOptions.filter((repo) => repo.toLowerCase().includes(normalizedFilter))
  }, [repoOptions, repoFilterQuery])
  const filteredCreateIssueRepos = useMemo(() => {
    const normalizedFilter = createIssueRepoQuery.trim().toLowerCase()
    if (!normalizedFilter) {
      return availableRepos
    }

    return availableRepos.filter((repo) => repo.toLowerCase().includes(normalizedFilter))
  }, [availableRepos, createIssueRepoQuery])
  const activeIssue = issues[0]
  const activePr = pullRequests[0]
  const activeIssueAssessmentKey = activeIssue ? toIssueAssessmentKey(activeIssue) : ''
  const activeIssueAssessmentEntry = activeIssueAssessmentKey
    ? assessedIssueLookup[activeIssueAssessmentKey]
    : undefined
  const isActiveIssueAssessed =
    activeIssueAssessmentKey.length > 0 && activeIssueAssessmentEntry !== undefined
  const activeIssueAssessmentSessionUrl =
    activeIssueAssessmentEntry?.sessionUrl ??
    (activeIssueAssessmentKey
      ? findLatestIssueAssessmentSessionUrl(jobs, activeIssueAssessmentKey)
      : undefined)
  const activePullRequestKey = activePr ? toIssueAssessmentKey(activePr) : ''
  const activePullRequestAssessmentEntry = activePullRequestKey
    ? assessedPrLookup[activePullRequestKey]
    : undefined
  const isActivePrAssessed =
    activePullRequestKey.length > 0 && activePullRequestAssessmentEntry !== undefined
  const activePullRequestAssessmentSessionUrl =
    activePullRequestAssessmentEntry?.sessionUrl ??
    (activePullRequestKey
      ? findLatestPullRequestAssessmentSessionUrl(jobs, activePullRequestKey)
      : undefined)
  const activePullRequestReviewLink = activePr
    ? buildDevinReviewPullRequestUrl(activePr.repo, activePr.id)
    : undefined
  const isActivePullRequestInMergeConflict =
    activePullRequestKey.length > 0 &&
    mergeConflictLookup[activePullRequestKey] !== undefined
  const activePullRequestConflictResolutionStatus = activePullRequestKey
    ? mergeConflictResolutionLookup[activePullRequestKey]
    : undefined
  const isActivePullRequestConflictResolutionRunning =
    activePullRequestConflictResolutionStatus === 'running'
  const isActivePullRequestConflictResolved =
    activePullRequestConflictResolutionStatus === 'resolved'
  const runningJobsCount = jobs.reduce(
    (count, job) => count + (job.status === 'running' ? 1 : 0),
    0,
  )
  const completedJobsCount = jobs.reduce(
    (count, job) => count + (job.status === 'success' || job.status === 'failed' ? 1 : 0),
    0,
  )
  const assessedCount = Object.keys(assessedIssueLookup).length + Object.keys(assessedPrLookup).length
  const hasActiveGithubFeed = hasSyncedGithubFeed && hasGithubOauthSession
  const desktopIssueCountLabel =
    isDesktopLayout && hasActiveGithubFeed ? `Issues (${issues.length})` : 'Issues'
  const desktopPullRequestCountLabel =
    isDesktopLayout && hasActiveGithubFeed ? `PRs (${pullRequests.length})` : 'PRs'
  const desktopSwipeTab: TabKey = activeTab === 'issues' ? 'issues' : 'pullRequests'
  const desktopLeftSwipeAction =
    activeTab === 'code' ? null : getSwipeAction(desktopSwipeTab, 'left')
  const desktopRightSwipeAction =
    activeTab === 'code' ? null : getSwipeAction(desktopSwipeTab, 'right')
  const desktopDownSwipeAction =
    activeTab === 'code' ? null : getSwipeAction(desktopSwipeTab, 'down')
  const showDesktopLeftNav = isDesktopLayout && hasActiveGithubFeed
  const showDesktopWideRail = showDesktopLeftNav && isDesktopWideLayout
  const showDesktopRightRail = showDesktopLeftNav && (showDesktopWideRail || isSettingsOpen)
  const showDesktopSettingsPanel = showDesktopRightRail && isSettingsOpen
  const showDesktopActivityRail = showDesktopRightRail && showDesktopWideRail && !isSettingsOpen
  const showDesktopMainActivity = showDesktopLeftNav && !showDesktopWideRail && isDesktopActivityOpen
  const canTriggerDesktopSwipe =
    isDesktopLayout &&
    hasActiveGithubFeed &&
    activeTab !== 'code' &&
    !showDesktopMainActivity &&
    Boolean(topCard)
  const hasApiKey = hasDevinSession || devinApiKey.trim().length > 0
  const hasDevinOrgId = devinOrgId.trim().length > 0
  const hasGithubScope = githubSearchScope.trim().length > 0
  const canSyncGithubFeed =
    hasDevinSession &&
    hasDevinOrgId &&
    HAS_GITHUB_OAUTH_CONFIG &&
    hasGithubOauthSession &&
    hasGithubScope
  const shouldAutoSyncStartup =
    !hasActiveGithubFeed &&
    !hasAttemptedStartupSyncRef.current &&
    !isLoadingDevinSession &&
    !isCheckingGithubOauthSession &&
    hasDevinSession &&
    hasDevinOrgId &&
    hasGithubOauthSession &&
    hasGithubScope
  const showStartupLoadingState =
    !hasActiveGithubFeed &&
    (isSyncingGithubFeed ||
      isCheckingGithubOauthSession ||
      isLoadingDevinSession ||
      shouldAutoSyncStartup)
  const shouldShowCredentialSetup = !hasActiveGithubFeed && !showStartupLoadingState

  useEffect(() => {
    if (prefersReducedMotion) {
      setStartupIntroPhase('done')
      return
    }

    if (!shouldShowCredentialSetup) {
      setStartupIntroPhase('idle')
      return
    }

    setStartupIntroCycle((previous) => previous + 1)
    setStartupIntroPhase('playing')
    const timeoutId = window.setTimeout(() => {
      setStartupIntroPhase('done')
    }, 1250)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [prefersReducedMotion, shouldShowCredentialSetup])

  const showToast = (message: string, onUndo?: () => void, timeoutMs?: number) => {
    setToastMessage(message)
    setToastUndoCallback(() => onUndo ?? null)

    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current)
    }

    const resolvedTimeoutMs = onUndo ? timeoutMs ?? 4000 : timeoutMs ?? 1250
    toastTimeoutRef.current = window.setTimeout(() => {
      setToastMessage(null)
      setToastUndoCallback(null)
    }, resolvedTimeoutMs)
  }

  const updateDragOffset = (nextOffset: { x: number; y: number }) => {
    dragOffsetRef.current = nextOffset
    setDragOffset(nextOffset)
  }

  const resetDrag = () => {
    updateDragOffset({ x: 0, y: 0 })
    dragVelocityRef.current = 0
    dragVerticalVelocityRef.current = 0
    setIsDragging(false)
    setIsAnimatingOut(false)
    setSwipeDirection(null)
    setIsDesktopButtonSwipe(false)
  }

  const removeTopCard = (tab: TabKey) => {
    if (tab === 'issues') {
      setIssues((previous) => previous.slice(1))
      return
    }

    if (tab !== 'pullRequests') {
      return
    }

    setPullRequests((previous) => previous.slice(1))
  }

  const moveTopCardToBack = (tab: TabKey) => {
    if (tab === 'issues') {
      setIssues((previous) => {
        if (previous.length <= 1) {
          return previous
        }

        return [...previous.slice(1), previous[0]]
      })
      return
    }

    if (tab !== 'pullRequests') {
      return
    }

    setPullRequests((previous) => {
      if (previous.length <= 1) {
        return previous
      }

      return [...previous.slice(1), previous[0]]
    })
  }

  const restorePullRequestCard = (card: PullRequestCard) => {
    const cardKey = toIssueAssessmentKey(card)

    setPullRequests((previous) => {
      const alreadyPresent = previous.some((entry) => {
        if (cardKey) {
          return toIssueAssessmentKey(entry) === cardKey
        }

        return (
          entry.id === card.id &&
          normalizeRepoPath(entry.repo) === normalizeRepoPath(card.repo)
        )
      })

      if (alreadyPresent) {
        return previous
      }

      return [card, ...previous]
    })
  }

  const restoreIssueCard = (card: IssueCard) => {
    const cardKey = toIssueAssessmentKey(card)

    setIssues((previous) => {
      const alreadyPresent = previous.some((entry) => {
        if (cardKey) {
          return toIssueAssessmentKey(entry) === cardKey
        }

        return (
          entry.id === card.id &&
          normalizeRepoPath(entry.repo) === normalizeRepoPath(card.repo)
        )
      })

      if (alreadyPresent) {
        return previous
      }

      return [card, ...previous]
    })
  }

  const addAction = (label: string, outcome: 'pending' | 'success' | 'failed'): number => {
    void label
    void outcome
    const actionId = nextActionIdRef.current
    nextActionIdRef.current += 1
    return actionId
  }

  const updateAction = (actionId: number, patch: Record<string, unknown>) => {
    void actionId
    void patch
  }

  const addJob = (
    label: string,
    target: string,
    options: { retryable?: boolean; retryPrompt?: string } = {},
  ): number => {
    const { retryable = false, retryPrompt } = options
    const jobId = nextJobIdRef.current
    nextJobIdRef.current += 1

    setJobs((previous) =>
      [
        {
          id: jobId,
          label,
          target,
          status: 'running' as const,
          message: 'Running...',
          retryable,
          retryPrompt,
          createdAt: Date.now(),
        },
        ...previous,
      ],
    )

    return jobId
  }

  const updateJob = (jobId: number, patch: Partial<JobEntry>) => {
    setJobs((previous) =>
      previous.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
    )
  }

  const getDevinAuthIssue = () => {
    if (!hasApiKey) {
      return 'Add a Devin service user API key in settings to run Devin actions.'
    }
    if (!hasDevinOrgId) {
      return 'Add a Devin organization ID in settings to run Devin actions.'
    }
    return null
  }

  const getGithubFeedAuthIssue = (tokenCandidate: string) => {
    if (!HAS_GITHUB_OAUTH_CONFIG) {
      return 'Configure GitHub OAuth URLs to enable feed sync.'
    }

    const token = tokenCandidate.trim()
    if (!token) {
      return 'Connect GitHub OAuth to sync issues and PRs directly from GitHub Search API.'
    }

    return null
  }

  const buildDefaultDevinSessionsCollectionEndpoint = () =>
    `${DEVIN_PROXY_BASE_URL}/organizations/sessions`

  const buildDevinSessionsCollectionEndpoint = () => {
    const trimmedOrgId = devinOrgId.trim()
    if (!trimmedOrgId) {
      return buildDefaultDevinSessionsCollectionEndpoint()
    }

    return `${DEVIN_PROXY_BASE_URL}/organizations/${encodeURIComponent(trimmedOrgId)}/sessions`
  }

  const parseDevinError = async (response: Response) => {
    const fallback = `${response.status} ${response.statusText}`.trim()
    const raw = await response.text()

    if (!raw) {
      return fallback
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const messageCandidate =
        typeof parsed.error === 'string'
          ? parsed.error
          : typeof parsed.message === 'string'
            ? parsed.message
            : typeof parsed.detail === 'string'
              ? parsed.detail
              : null

      return messageCandidate ? `${fallback}: ${messageCandidate}` : `${fallback}: ${raw}`
    } catch {
      return `${fallback}: ${raw}`
    }
  }

  const refreshGithubOauthSessionToken = async (options?: { silent?: boolean }) => {
    if (!HAS_GITHUB_OAUTH_CONFIG) {
      setHasGithubOauthSession(false)
      setGithubOauthLogin(null)
      return ''
    }

    try {
      const response = await fetch(GITHUB_OAUTH_TOKEN_URL, {
        headers: {
          Accept: 'application/json',
        },
        credentials: 'include',
      })

      if (response.status === 204 || response.status === 401 || response.status === 404) {
        setHasGithubOauthSession(false)
        setGithubOauthLogin(null)
        return ''
      }

      if (!response.ok) {
        throw new Error(await parseDevinError(response))
      }

      const raw = (await response.text()).trim()
      const payload = raw.length > 0 ? (JSON.parse(raw) as unknown) : null
      const token = extractGithubOauthToken(payload)
      const login = extractGithubOauthLogin(payload)

      if (!token) {
        setHasGithubOauthSession(false)
        setGithubOauthLogin(null)
        return ''
      }

      setHasGithubOauthSession(true)
      setGithubOauthLogin(login)
      if (login && githubSearchScope.trim().length === 0) {
        setGithubSearchScope(`user:${login}`)
      }
      return token
    } catch (error) {
      if (!options?.silent) {
        const message =
          error instanceof Error ? error.message : 'Unable to refresh GitHub OAuth session.'
        showToast(`GitHub OAuth session check failed: ${message}`)
      }
      return ''
    }
  }

  const handleStartGithubOauth = () => {
    if (!HAS_GITHUB_OAUTH_CONFIG) {
      showToast('Set GitHub OAuth URLs before attempting to connect.')
      return
    }

    window.location.assign(GITHUB_OAUTH_START_URL)
  }

  const clearPersistedGithubSearchScope = async () => {
    setGithubSearchScope('')

    if (!hasDevinSession) {
      return
    }

    try {
      await fetch(DEVIN_SESSION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          orgId: devinOrgId.trim(),
          createAsUserId: devinCreateAsUserId.trim(),
          githubSearchScope: '',
        }),
      })
    } catch {
      return
    }
  }

  const resetSyncedGithubFeedState = () => {
    setHasSyncedGithubFeed(false)
    setIssues([])
    setPullRequests([])
    setPullRequestCodeLookup({})
    setMergeConflictLookup({})
    setMergeConflictCheckLookup({})
    setMergeConflictResolutionLookup({})
    mergeConflictPollingLookupRef.current = {}
    setLastGithubSyncSummary(null)
    setIsDesktopActivityOpen(false)
    hasAttemptedStartupSyncRef.current = false
  }

  const applyGithubSignedOutUiState = () => {
    setHasGithubOauthSession(false)
    setGithubOauthLogin(null)
    resetSyncedGithubFeedState()
  }

  const handleDisconnectGithubOauth = async () => {
    if (isDisconnectingGithubOauthSession) {
      return
    }

    applyGithubSignedOutUiState()
    if (!isDesktopLayout) {
      setIsSettingsOpen(false)
    }
    await clearPersistedGithubSearchScope()

    if (!GITHUB_OAUTH_DISCONNECT_URL) {
      return
    }

    setIsDisconnectingGithubOauthSession(true)

    try {
      const response = await fetch(GITHUB_OAUTH_DISCONNECT_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
        credentials: 'include',
      })

      if (!response.ok && response.status !== 204) {
        throw new Error(await parseDevinError(response))
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to disconnect GitHub OAuth.'
      showToast(`Signed out locally. GitHub OAuth disconnect failed on server: ${message}`)
    } finally {
      setIsDisconnectingGithubOauthSession(false)
    }
  }

  const resolveGithubAccessToken = async (options?: { silent?: boolean }) => {
    if (!HAS_GITHUB_OAUTH_CONFIG) {
      return ''
    }

    return refreshGithubOauthSessionToken({ silent: options?.silent ?? true })
  }

  const fetchGithubSearchItems = async (
    kind: 'issues' | 'pullRequests',
    githubAccessToken: string,
  ) => {
    const token = githubAccessToken.trim()
    const queryParts = [
      kind === 'issues' ? 'is:issue' : 'is:pr',
      'is:open',
      'archived:false',
    ]
    const scopeQualifier = normalizeGithubScopeQualifier(githubSearchScope)
    if (scopeQualifier) {
      queryParts.unshift(scopeQualifier)
    }

    const query = queryParts.join(' ')
    const collected: GithubSearchItem[] = []
    const perPage = 50
    const maxPages = 2

    for (let page = 1; page <= maxPages; page += 1) {
      const params = new URLSearchParams({
        q: query,
        sort: 'updated',
        order: 'desc',
        per_page: String(perPage),
        page: String(page),
      })

      const response = await fetch(
        `https://api.github.com/search/issues?${params.toString()}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      )

      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new Error(
          'GitHub API rate limit exceeded. Wait for rate limit reset or use a token with higher limits.',
        )
      }

      if (!response.ok) {
        throw new Error(await parseDevinError(response))
      }

      const payload = (await response.json()) as GithubSearchResponse
      const items = Array.isArray(payload.items) ? payload.items : []
      collected.push(...items)

      if (items.length < perPage) {
        break
      }
    }

    return collected
  }

  const fetchGithubPullRequestFiles = async (
    repoPath: string,
    pullNumber: number,
    githubAccessToken: string,
  ) => {
    const token = githubAccessToken.trim()
    if (!token) {
      throw new Error('Missing GitHub OAuth token.')
    }

    const normalizedRepoPath = normalizeRepoPath(repoPath)
    const [owner, repo] = normalizedRepoPath.split('/')
    if (!owner || !repo) {
      throw new Error(`Invalid repository path: ${repoPath}`)
    }

    const files: GithubPullRequestFile[] = []
    const perPage = 100
    const maxPages = 3

    for (let page = 1; page <= maxPages; page += 1) {
      const response = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/files?per_page=${perPage}&page=${page}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      )

      if (!response.ok) {
        throw new Error(await parseDevinError(response))
      }

      const payload = (await response.json()) as GithubPullRequestFile[]
      const pageFiles = Array.isArray(payload) ? payload : []
      files.push(...pageFiles)

      if (pageFiles.length < perPage) {
        break
      }
    }

    return files
  }

  const closeGithubIssue = async (repoPath: string, issueNumber: number) => {
    const githubAccessToken = await resolveGithubAccessToken({ silent: true })
    const authIssue = getGithubFeedAuthIssue(githubAccessToken)
    if (authIssue) {
      throw new Error(authIssue)
    }

    const normalizedRepoPath = normalizeRepoPath(repoPath)
    const [owner, repo] = normalizedRepoPath.split('/')
    if (!owner || !repo) {
      throw new Error(`Invalid repository path: ${repoPath}`)
    }

    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubAccessToken}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ state: 'closed' }),
      },
    )

    if (!response.ok) {
      throw new Error(await parseDevinError(response))
    }
  }

  const createGithubIssue = async (repoPath: string, title: string, body: string) => {
    const githubAccessToken = await resolveGithubAccessToken({ silent: true })
    const authIssue = getGithubFeedAuthIssue(githubAccessToken)
    if (authIssue) {
      throw new Error(authIssue)
    }

    const issueTitle = title.trim()
    if (!issueTitle) {
      throw new Error('Issue title cannot be empty.')
    }

    const normalizedRepoPath = normalizeRepoPath(repoPath)
    const [owner, repo] = normalizedRepoPath.split('/')
    if (!owner || !repo) {
      throw new Error(`Invalid repository path: ${repoPath}`)
    }

    const payload: { title: string; body?: string } = { title: issueTitle }
    const issueBody = body.trim()
    if (issueBody) {
      payload.body = issueBody
    }

    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubAccessToken}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify(payload),
      },
    )

    if (!response.ok) {
      throw new Error(await parseDevinError(response))
    }

    const data = (await response.json()) as { number?: number; html_url?: string }
    return data
  }

  const closeGithubPullRequest = async (repoPath: string, pullNumber: number) => {
    const githubAccessToken = await resolveGithubAccessToken({ silent: true })
    const authIssue = getGithubFeedAuthIssue(githubAccessToken)
    if (authIssue) {
      throw new Error(authIssue)
    }

    const normalizedRepoPath = normalizeRepoPath(repoPath)
    const [owner, repo] = normalizedRepoPath.split('/')
    if (!owner || !repo) {
      throw new Error(`Invalid repository path: ${repoPath}`)
    }

    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubAccessToken}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ state: 'closed' }),
      },
    )

    if (!response.ok) {
      throw new Error(await parseDevinError(response))
    }
  }

  const mergeGithubPullRequest = async (repoPath: string, pullNumber: number) => {
    const githubAccessToken = await resolveGithubAccessToken({ silent: true })
    const authIssue = getGithubFeedAuthIssue(githubAccessToken)
    if (authIssue) {
      throw new Error(authIssue)
    }

    const normalizedRepoPath = normalizeRepoPath(repoPath)
    const [owner, repo] = normalizedRepoPath.split('/')
    if (!owner || !repo) {
      throw new Error(`Invalid repository path: ${repoPath}`)
    }

    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/merge`,
      {
        method: 'PUT',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubAccessToken}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({}),
      },
    )

    if (!response.ok) {
      throw new Error(await parseDevinError(response))
    }

    let payload: { merged?: boolean; message?: string } | null = null
    try {
      payload = (await response.json()) as {
        merged?: boolean
        message?: string
      }
    } catch {
      payload = null
    }

    if (payload?.merged === false) {
      const message =
        typeof payload.message === 'string' && payload.message.trim().length > 0
          ? payload.message.trim()
          : `GitHub could not merge PR #${pullNumber}.`
      throw new Error(message)
    }
  }

  const postGithubPullRequestComment = async (
    repoPath: string,
    pullNumber: number,
    body: string,
  ) => {
    const githubAccessToken = await resolveGithubAccessToken({ silent: true })
    const authIssue = getGithubFeedAuthIssue(githubAccessToken)
    if (authIssue) {
      throw new Error(authIssue)
    }

    const commentBody = body.trim()
    if (!commentBody) {
      throw new Error('Comment body cannot be empty.')
    }

    const normalizedRepoPath = normalizeRepoPath(repoPath)
    const [owner, repo] = normalizedRepoPath.split('/')
    if (!owner || !repo) {
      throw new Error(`Invalid repository path: ${repoPath}`)
    }

    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${pullNumber}/comments`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubAccessToken}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ body: commentBody }),
      },
    )

    if (!response.ok) {
      throw new Error(await parseDevinError(response))
    }
  }

  const createDevinSession = async (
    prompt: string,
    options: {
      skipCreateAsUserId?: boolean
      title?: string
      tags?: string[]
      maxAcuLimit?: number
      structuredOutputSchema?: Record<string, unknown>
    } = {},
  ) => {
    const authIssue = getDevinAuthIssue()
    if (authIssue) {
      throw new Error(authIssue)
    }

    const payload: {
      prompt: string
      create_as_user_id?: string
      title?: string
      tags?: string[]
      max_acu_limit?: number
      structured_output_schema?: Record<string, unknown>
    } = { prompt }

    const title = options.title?.trim()
    if (title) {
      payload.title = title
    }

    const tags =
      options.tags
        ?.map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 8) ?? []
    if (tags.length > 0) {
      payload.tags = tags
    }

    if (
      typeof options.maxAcuLimit === 'number' &&
      Number.isFinite(options.maxAcuLimit) &&
      options.maxAcuLimit > 0
    ) {
      payload.max_acu_limit = Math.floor(options.maxAcuLimit)
    }

    if (options.structuredOutputSchema) {
      payload.structured_output_schema = options.structuredOutputSchema
    }

    if (!options.skipCreateAsUserId) {
      const createAsUserId = devinCreateAsUserId.trim()
      if (createAsUserId) {
        payload.create_as_user_id = createAsUserId
      }
    }

    const response = await fetch(buildDevinSessionsCollectionEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(await parseDevinError(response))
    }

    const data = (await response.json()) as DevinSessionPayload
    setHasVerifiedDevinConnection(true)
    return data
  }

  const fetchDevinSessionById = async (sessionId: string) => {
    const authIssue = getDevinAuthIssue()
    if (authIssue) {
      throw new Error(authIssue)
    }

    const endpoints = Array.from(
      new Set([
        buildDevinSessionsCollectionEndpoint(),
        buildDefaultDevinSessionsCollectionEndpoint(),
      ]),
    )

    let lastErrorMessage = 'Unable to load session.'

    for (const sessionsEndpoint of endpoints) {
      const endpoint = `${sessionsEndpoint}/${encodeURIComponent(sessionId)}`
      const response = await fetch(endpoint)

      if (response.ok) {
        const data = (await response.json()) as DevinSessionPayload
        setHasVerifiedDevinConnection(true)
        return data
      }

      const parsedError = await parseDevinError(response)
      lastErrorMessage = parsedError

      const shouldTryNextEndpoint =
        (response.status === 401 || response.status === 403 || response.status === 404) &&
        sessionsEndpoint !== endpoints[endpoints.length - 1]

      if (!shouldTryNextEndpoint) {
        throw new Error(parsedError)
      }
    }

    throw new Error(lastErrorMessage)
  }

  const pollDevinSessionForPrUrl = async (
    sessionId: string,
    jobId: number,
  ) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, attempt === 0 ? 5000 : 10000)
      })
      try {
        const data = await fetchDevinSessionById(sessionId)
        const nextDevinStatus = typeof data.status === 'string' ? data.status : undefined
        const nextStatusDetail =
          typeof data.status_detail === 'string' && data.status_detail.trim().length > 0
            ? data.status_detail.trim()
            : undefined
        updateJob(jobId, { devinStatus: nextDevinStatus, statusDetail: nextStatusDetail })
        if (data.structured_output && typeof data.structured_output === 'object') {
          const output = data.structured_output as Record<string, unknown>
          if (typeof output.pull_request_url === 'string' && output.pull_request_url.trim().length > 0) {
            updateJob(jobId, { pullRequestUrl: output.pull_request_url.trim() })
            return
          }
        }
        if (isTerminalDevinStatus(data.status)) {
          return
        }
      } catch {
        // continue polling
      }
    }
  }

  const handleSyncGithubFeed = async (options?: { autoTriggered?: boolean }) => {
    if (isSyncingGithubFeed) {
      return
    }

    const isAutoTriggered = options?.autoTriggered === true
    if (isAutoTriggered) {
      setIsSyncingGithubFeed(true)
      setLastGithubSyncSummary(null)
    }

    const githubAccessToken = await resolveGithubAccessToken({ silent: true })
    const authIssue = getGithubFeedAuthIssue(githubAccessToken)
    if (authIssue) {
      if (!isAutoTriggered) {
        showToast(authIssue)
      } else {
        setIsSyncingGithubFeed(false)
      }
      return
    }

    if (!isAutoTriggered) {
      setIsSyncingGithubFeed(true)
      setLastGithubSyncSummary(null)
    }
    const actionId = addAction('Sync GitHub triage feed', 'pending')

    if (!isAutoTriggered) {
      showToast('Syncing GitHub issues and pull requests from GitHub Search API...')
    }

    try {
      const [issueItems, pullRequestItems] = await Promise.all([
        fetchGithubSearchItems('issues', githubAccessToken),
        fetchGithubSearchItems('pullRequests', githubAccessToken),
      ])

      const syncedIssues = issueItems
        .map(mapIssueFromGithubSearchItem)
        .filter((item): item is IssueCard => item !== null)
      const syncedPullRequests = pullRequestItems
        .map(mapPullRequestFromGithubSearchItem)
        .filter((item): item is PullRequestCard => item !== null)

      setIssues(roundRobinByRepo(syncedIssues))
      setPullRequests(syncedPullRequests)
      setPullRequestCodeLookup({})
      setMergeConflictLookup({})
      setMergeConflictCheckLookup({})
      setMergeConflictResolutionLookup({})
      mergeConflictPollingLookupRef.current = {}

      const scopeLabel = normalizeGithubScopeQualifier(githubSearchScope)
      const summaryCore = `${syncedIssues.length} issues • ${syncedPullRequests.length} PRs`
      const summary = scopeLabel ? `${summaryCore} (${scopeLabel})` : summaryCore
      setLastGithubSyncSummary(summary)
      setHasSyncedGithubFeed(true)
      if (!isAutoTriggered) {
        setIsSettingsOpen(false)
      }

      updateAction(actionId, { outcome: 'success' })


    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to sync GitHub feed.'
      setLastGithubSyncSummary(`Sync failed: ${message}`)
      updateAction(actionId, { outcome: 'failed' })
      if (!isAutoTriggered) {
        showToast(`GitHub sync failed: ${message}`)
      }
    } finally {
      setIsSyncingGithubFeed(false)
    }
  }

  syncGithubFeedRef.current = handleSyncGithubFeed

  const handleVerifyDevinConnection = async () => {
    if (isVerifyingDevinConnection) {
      return
    }

    const keyToSave = devinApiKey.trim()
    if (!keyToSave && !hasApiKey) {
      showToast('Add a Devin service user API key to verify.')
      return
    }

    const orgIdToSave = devinOrgId.trim()
    if (!orgIdToSave) {
      showToast('Add a Devin organization ID to verify.')
      return
    }

    setIsVerifyingDevinConnection(true)
    const actionId = addAction('Verify Devin API key', 'pending')

    try {
      // Save credentials to server session (apiKey omitted if not re-entered — server keeps existing)
      const saveRes = await fetch(DEVIN_SESSION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(keyToSave ? { apiKey: keyToSave } : {}),
          orgId: orgIdToSave,
          createAsUserId: devinCreateAsUserId.trim(),
          githubSearchScope: githubSearchScope.trim(),
        }),
      })
      if (!saveRes.ok) {
        const err = await saveRes.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? 'Failed to save credentials.')
      }
      if (keyToSave) {
        setDevinApiKey('') // clear input — key is now server-side only
        setHasDevinSession(true)
      }

      const response = await fetch(buildDevinSessionsCollectionEndpoint())

      if (!response.ok) {
        throw new Error(await parseDevinError(response))
      }

      updateAction(actionId, { outcome: 'success' })
      setHasVerifiedDevinConnection(true)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to reach Devin API.'
      updateAction(actionId, { outcome: 'failed' })
      setHasVerifiedDevinConnection(false)
      showToast(`Devin auth failed: ${message}`)
    } finally {
      setIsVerifyingDevinConnection(false)
    }
  }

  const runSwipeSideEffect = async (
    tab: TabKey,
    direction: SwipeDirection,
    card: TriageCard,
  ) => {
    if (direction === 'down') {
      const label =
        card.kind === 'issue'
          ? `Skipped issue #${card.id}`
          : `Skipped PR #${card.id}`
      addAction(label, 'success')
      return
    }

    if (tab === 'issues') {
      if (direction === 'left') {
        const actionId = addAction(`Close issue #${card.id} on GitHub`, 'pending')
        const jobId = addJob('Close issue', `${card.repo} #${card.id}`)

        try {
          await closeGithubIssue(card.repo, card.id)
          updateJob(jobId, {
            status: 'success',
            message: `Issue #${card.id} closed on GitHub.`,
            retryable: false,
          })
          updateAction(actionId, { outcome: 'success' })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unable to close issue on GitHub.'
          updateJob(jobId, {
            status: 'failed',
            message: `Close issue failed: ${message}`,
            retryable: false,
          })
          updateAction(actionId, { outcome: 'failed' })
          showToast(`Failed to close issue #${card.id}: ${message}`)
        }

        return
      }

      const actionId = addAction(`Create PR from issue #${card.id}`, 'pending')
      const prompt = [
        `You are triaging issue #${card.id} in repository ${card.repo}.`,
        'Create a finished pull request that resolves the issue with minimal risk and clear tests.',
        'Share the PR link plus a concise implementation summary.',
        'Issue context:',
        formatCardContext(card),
      ].join('\n\n')
      const jobId = addJob('Create PR', `${card.repo} #${card.id}`, {
        retryable: true,
        retryPrompt: prompt,
      })

      try {
        const session = await createDevinSession(prompt)
        const sessionUrl =
          typeof session.url === 'string' && session.url.trim().length > 0
            ? session.url.trim()
            : undefined
        updateJob(jobId, {
          status: 'success',
          message: `Devin session started. ${formatSessionReference(session)}`,
          retryable: false,
          retryPrompt: undefined,
          sessionUrl,
        })
        updateAction(actionId, { outcome: 'success' })
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to create Devin session.'
        updateJob(jobId, {
          status: 'failed',
          message: `Create PR request failed: ${message}`,
          retryable: true,
        })
        updateAction(actionId, { outcome: 'failed' })
        showToast('Create PR request failed. Open Activity to retry.')
      }
      return
    }

    if (tab !== 'pullRequests' || card.kind !== 'pullRequest') {
      return
    }

    const pullRequestKey = toIssueAssessmentKey(card)

    if (direction === 'left') {
      const actionId = addAction(`Close PR #${card.id} on GitHub`, 'pending')
      const jobId = addJob('Close PR', `${card.repo} #${card.id}`)

      try {
        await closeGithubPullRequest(card.repo, card.id)
        if (pullRequestKey) {
          setMergeConflictLookup((previous) => {
            if (previous[pullRequestKey] === undefined) {
              return previous
            }

            const next = { ...previous }
            delete next[pullRequestKey]
            return next
          })
          setMergeConflictResolutionLookup((previous) => {
            if (previous[pullRequestKey] === undefined) {
              return previous
            }

            const next = { ...previous }
            delete next[pullRequestKey]
            return next
          })
          setMergeConflictCheckLookup((previous) => {
            if (previous[pullRequestKey] === undefined) {
              return previous
            }

            const next = { ...previous }
            delete next[pullRequestKey]
            return next
          })
        }

        updateJob(jobId, {
          status: 'success',
          message: `PR #${card.id} closed on GitHub.`,
          retryable: false,
        })
        updateAction(actionId, { outcome: 'success' })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to close pull request on GitHub.'
        restorePullRequestCard(card)
        updateJob(jobId, {
          status: 'failed',
          message: `Close PR failed: ${message}`,
          retryable: false,
        })
        updateAction(actionId, { outcome: 'failed' })
        showToast(`Failed to close PR #${card.id}: ${message}`)
      }

      return
    }

    const hasBlockingChecks = card.checks.some((check) => !check.passed)
    if (!hasBlockingChecks) {
      const actionId = addAction(`Merge PR #${card.id} on GitHub`, 'pending')
      const jobId = addJob('Merge PR', `${card.repo} #${card.id}`)

      try {
        await mergeGithubPullRequest(card.repo, card.id)
        if (pullRequestKey) {
          setMergeConflictLookup((previous) => {
            if (previous[pullRequestKey] === undefined) {
              return previous
            }

            const next = { ...previous }
            delete next[pullRequestKey]
            return next
          })
          setMergeConflictResolutionLookup((previous) => {
            if (previous[pullRequestKey] === undefined) {
              return previous
            }

            const next = { ...previous }
            delete next[pullRequestKey]
            return next
          })
        }
        updateJob(jobId, {
          status: 'success',
          message: `PR #${card.id} merged on GitHub.`,
          retryable: false,
        })
        updateAction(actionId, { outcome: 'success' })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to merge pull request on GitHub.'
        const hasMergeConflict = isMergeConflictErrorMessage(message)
        restorePullRequestCard(card)
        if (hasMergeConflict && pullRequestKey) {
          setMergeConflictLookup((previous) => ({
            ...previous,
            [pullRequestKey]: Date.now(),
          }))
          setMergeConflictResolutionLookup((previous) => {
            if (previous[pullRequestKey] === undefined) {
              return previous
            }

            const next = { ...previous }
            delete next[pullRequestKey]
            return next
          })
        }
        updateJob(jobId, {
          status: 'failed',
          message: `Merge PR failed: ${message}`,
          retryable: false,
        })
        updateAction(actionId, { outcome: 'failed' })
        showToast(
          hasMergeConflict
            ? `PR #${card.id} has a merge conflict. Use Devin Fix Merge Conflict.`
            : `Failed to merge PR #${card.id}: ${message}`,
        )
      }

      return
    }

    const actionId = addAction(
      `Enroll auto-merge for PR #${card.id}`,
      'pending',
    )
    const prompt = [
      `Checks are currently blocking merge for pull request #${card.id} in ${card.repo}.`,
      'Attempt auto-merge enrollment when policy permits and summarize the outcome.',
      'If enrollment is blocked, explain which permission or check is preventing it.',
      'Pull request context:',
      formatCardContext(card),
    ].join('\n\n')
    const jobId = addJob('Auto-merge enrollment', `${card.repo} #${card.id}`, {
      retryable: true,
      retryPrompt: prompt,
    })

    try {
      const session = await createDevinSession(prompt)
      updateJob(jobId, {
        status: 'success',
        message: `Auto-merge workflow started. ${formatSessionReference(session)}`,
        retryable: false,
        retryPrompt: undefined,
      })
      updateAction(actionId, { outcome: 'success' })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to create Devin session.'
      updateJob(jobId, {
        status: 'failed',
        message: `Auto-merge enrollment failed: ${message}`,
        retryable: true,
      })
      updateAction(actionId, { outcome: 'failed' })
      showToast('Auto-merge enrollment failed. Open Activity to retry.')
    }
  }

  const isUndoableSwipe = (tab: TabKey, direction: SwipeDirection) => {
    if (direction === 'down') {
      return false
    }

    if (tab === 'pullRequests') {
      return true
    }

    return tab === 'issues'
  }

  const getSwipeExitDurationMs = (
    direction: SwipeDirection,
    offset: { x: number; y: number },
  ) => {
    if (prefersReducedMotion) {
      return 90
    }

    const isButtonTriggered = offset.x === 0 && offset.y === 0
    if (isDesktopLayout && isButtonTriggered) {
      return 420
    }

    const horizontalTravel = Math.max(swipeOutDistance - Math.abs(offset.x), 80)
    const downwardTravel = Math.max(swipeDownOutDistance - Math.max(offset.y, 0), 80)
    const travel = direction === 'down' ? downwardTravel : horizontalTravel

    return Math.round(Math.min(280, Math.max(150, 120 + Math.sqrt(travel) * 4)))
  }

  const commitSwipe = (direction: SwipeDirection) => {
    if (!topCard || isAnimatingOut) {
      return
    }

    if (pendingUndoRef.current) {
      window.clearTimeout(pendingUndoRef.current.timeoutId)
      pendingUndoRef.current = null
    }

    const tabAtSwipe = activeTab
    const cardAtSwipe = topCard
    const undoable = isUndoableSwipe(tabAtSwipe, direction)
    const undoTimeoutMs = 4000
    const exitDurationMs = getSwipeExitDurationMs(direction, dragOffsetRef.current)

    const buttonTriggered = dragOffsetRef.current.x === 0 && dragOffsetRef.current.y === 0
    setSwipeExitDurationMs(exitDurationMs)
    setSwipeDirection(direction)
    setIsAnimatingOut(true)
    setIsDesktopButtonSwipe(isDesktopLayout && buttonTriggered)
    setIsDragging(false)

    window.setTimeout(() => {
      if (direction === 'down') {
        moveTopCardToBack(tabAtSwipe)
      } else {
        removeTopCard(tabAtSwipe)
      }
      resetDrag()

      if (!undoable) {
        if (direction !== 'down') {
          showToast(getSwipeToast(tabAtSwipe, direction, cardAtSwipe))
        }
        void runSwipeSideEffect(tabAtSwipe, direction, cardAtSwipe)
        return
      }

      const pending = { timeoutId: 0, cancelled: false }
      pendingUndoRef.current = pending

      const undoHandler = () => {
        pending.cancelled = true
        window.clearTimeout(pending.timeoutId)
        pendingUndoRef.current = null
        if (tabAtSwipe === 'issues' && cardAtSwipe.kind === 'issue') {
          restoreIssueCard(cardAtSwipe)
        } else if (cardAtSwipe.kind === 'pullRequest') {
          restorePullRequestCard(cardAtSwipe)
        }
        showToast('Action undone.')
      }

      showToast(getSwipeToast(tabAtSwipe, direction, cardAtSwipe), undoHandler, undoTimeoutMs)

      pending.timeoutId = window.setTimeout(() => {
        if (pending.cancelled) return
        pendingUndoRef.current = null
        setToastUndoCallback(null)
        void runSwipeSideEffect(tabAtSwipe, direction, cardAtSwipe)
      }, undoTimeoutMs)
    }, exitDurationMs)
  }
  commitSwipeRef.current = commitSwipe

  const releaseDrag = () => {
    const horizontalDistanceThreshold = Math.max(86, window.innerWidth * 0.21)
    const downwardDistanceThreshold = Math.max(14, window.innerHeight * 0.02)
    const { x, y } = dragOffsetRef.current
    const velocityX = dragVelocityRef.current
    const velocityY = dragVerticalVelocityRef.current
    const hasHorizontalFlickIntent = Math.abs(velocityX) >= 0.52 && Math.abs(x) > 22
    const downwardDistance = Math.max(y, 0)
    const hasDownwardDistanceIntent =
      downwardDistance >= downwardDistanceThreshold &&
      downwardDistance > Math.abs(x) * 0.52
    const hasDownwardFlickIntent =
      velocityY >= 0.48 &&
      downwardDistance >= 10 &&
      downwardDistance > Math.abs(x) * 0.35

    if (hasDownwardDistanceIntent || hasDownwardFlickIntent) {
      commitSwipe('down')
      return
    }

    if (Math.abs(x) >= horizontalDistanceThreshold || hasHorizontalFlickIntent) {
      const direction: SwipeDirection =
        Math.abs(x) >= 22
          ? x > 0
            ? 'right'
            : 'left'
          : velocityX > 0
            ? 'right'
            : 'left'

      commitSwipe(direction)
      return
    }

    updateDragOffset({ x: 0, y: 0 })
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!topCard || isAnimatingOut) {
      return
    }

    const target = event.target
    if (!(target instanceof HTMLElement)) {
      return
    }

    if (
      target.closest('.card-scroll-content') ||
      target.closest('.repo-name-link') ||
      target.closest('a, button, input, textarea, select, [contenteditable="true"]')
    ) {
      return
    }

    pointerIdRef.current = event.pointerId
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    dragLastSampleRef.current = { x: event.clientX, y: event.clientY, time: event.timeStamp }
    dragVelocityRef.current = 0
    dragVerticalVelocityRef.current = 0
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isDragging || pointerIdRef.current !== event.pointerId) {
      return
    }

    event.preventDefault()

    const now = event.timeStamp
    const deltaTime = Math.max(now - dragLastSampleRef.current.time, 1)
    const deltaX = event.clientX - dragLastSampleRef.current.x
    const deltaY = event.clientY - dragLastSampleRef.current.y
    dragVelocityRef.current = deltaX / deltaTime
    dragVerticalVelocityRef.current = deltaY / deltaTime
    dragLastSampleRef.current = { x: event.clientX, y: event.clientY, time: now }

    const offsetX = event.clientX - dragStartRef.current.x
    const rawOffsetY = event.clientY - dragStartRef.current.y
    const offsetY =
      rawOffsetY >= 0
        ? Math.min(rawOffsetY * 0.58, 260)
        : rawOffsetY * 0.26

    updateDragOffset({ x: offsetX, y: offsetY })
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return
    }

    pointerIdRef.current = null
    setIsDragging(false)

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    releaseDrag()
  }

  const handleAssessNecessity = async () => {
    if (isAssessingIssue) {
      return
    }

    const issue = activeIssue
    if (!issue) {
      showToast('No issues left to assess.')
      return
    }

    const issueAssessmentKey = toIssueAssessmentKey(issue)
    const existingAssessment = issueAssessmentKey
      ? assessedIssueLookup[issueAssessmentKey]
      : undefined
    if (issueAssessmentKey && existingAssessment !== undefined) {
      const existingSessionUrl =
        existingAssessment.sessionUrl ??
        findLatestIssueAssessmentSessionUrl(jobs, issueAssessmentKey)

      showToast(
        existingSessionUrl
          ? 'This issue was already assessed. Use Assessment to review it.'
          : 'This issue was already assessed. Swipe to triage or skip.',
      )
      return
    }

    setIsAssessingIssue(true)
    const prompt = [
      `Assess issue #${issue.id} in ${issue.repo}.`,
      'Decide whether the issue is actionable now. Return a verdict, rationale, and next maintainers step.',
      'Issue context:',
      formatCardContext(issue),
    ].join('\n\n')
    const actionId = addAction('Assess issue necessity', 'pending')
    const jobId = addJob('Assess Necessity', `${issue.repo} #${issue.id}`, {
      retryable: true,
      retryPrompt: prompt,
    })
    showToast('Devin assessing...')

    try {
      const session = await createDevinSession(prompt, { skipCreateAsUserId: true })
      const sessionUrl =
        typeof session.url === 'string' && session.url.trim().length > 0
          ? session.url.trim()
          : undefined
      const sessionId =
        typeof session.session_id === 'string' && session.session_id.trim().length > 0
          ? session.session_id.trim()
          : toSessionIdFromSessionUrl(sessionUrl)
      updateJob(jobId, {
        status: 'success',
        message: `Assessment session started. ${formatSessionReference(session)}`,
        retryable: false,
        retryPrompt: undefined,
        sessionUrl,
      })
      setAssessedIssueLookup((previous) => {
        if (!issueAssessmentKey) {
          return previous
        }

        const existingEntry = previous[issueAssessmentKey]
        const nextEntry: AssessedIssueEntry = {
          assessedAt: existingEntry?.assessedAt ?? Date.now(),
          sessionUrl: sessionUrl ?? existingEntry?.sessionUrl,
          sessionId:
            sessionId ??
            existingEntry?.sessionId ??
            toSessionIdFromSessionUrl(sessionUrl ?? existingEntry?.sessionUrl),
        }

        if (
          existingEntry &&
          existingEntry.assessedAt === nextEntry.assessedAt &&
          existingEntry.sessionUrl === nextEntry.sessionUrl &&
          existingEntry.sessionId === nextEntry.sessionId
        ) {
          return previous
        }

        return { ...previous, [issueAssessmentKey]: nextEntry }
      })
      updateAction(actionId, { outcome: 'success' })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to create Devin session.'
      updateJob(jobId, {
        status: 'failed',
        message: `Assess necessity failed: ${message}`,
        retryable: true,
      })
      updateAction(actionId, { outcome: 'failed' })
      showToast('Assess necessity failed. Open Activity to retry.')
    } finally {
      setIsAssessingIssue(false)
    }
  }

  const handleCreateRepoPullRequest = async () => {
    if (isCreatingRepoRequest) {
      return
    }

    const isDevinsMachineTarget = selectedRepo === DEVINS_MACHINE_REPO_LABEL
    const repo = isDevinsMachineTarget ? '' : normalizeRepoPath(selectedRepo)
    if (!isDevinsMachineTarget && !repo) {
      showToast('Select a repository first.')
      return
    }

    const request = repoRequestPrompt.trim()
    if (!request) {
      showToast('Add a feature request for Devin before submitting.')
      return
    }

    setShipLaunchCount((count) => count + 1)
    setIsCreatingRepoRequest(true)
    const targetLabel = isDevinsMachineTarget ? DEVINS_MACHINE_REPO_LABEL : repo
    const prompt = isDevinsMachineTarget
      ? [
          `Workspace: ${DEVINS_MACHINE_REPO_LABEL}`,
          `Maintainer request: ${request}`,
          'Use Devin\'s existing repository context to identify the correct repository, implement the request, and open a pull request.',
          'If repository context is ambiguous, choose the best matching repository and proceed.',
          'Keep scope focused, add or update tests when appropriate, and summarize any risks.',
          'Return the PR URL, chosen repository, change summary, and verification steps.',
        ].join('\n\n')
      : [
          `Repository: ${repo}`,
          `Maintainer request: ${request}`,
          'Implement the requested feature in this repository and open a pull request.',
          'Keep scope focused, add or update tests when appropriate, and summarize any risks.',
          'Return the PR URL, change summary, and verification steps.',
        ].join('\n\n')
    const actionId = addAction(`Start implementation request in ${targetLabel}`, 'pending')
    const jobId = addJob('Implementation Request', targetLabel, {
      retryable: true,
      retryPrompt: prompt,
    })
    showToast(`Starting implementation request on ${targetLabel}...`)

    try {
      const repoTag = isDevinsMachineTarget
        ? 'devins-machine'
        : repo
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
      const session = await createDevinSession(prompt, {
        title: `Implementation Request: ${targetLabel}`,
        tags: ['implementation-request', repoTag].filter((tag) => tag.length > 0),
        structuredOutputSchema: {
          type: 'object',
          properties: {
            pull_request_url: { type: 'string', description: 'The URL of the created pull request' },
          },
          required: ['pull_request_url'],
        },
      })
      const sessionUrl =
        typeof session.url === 'string' && session.url.trim().length > 0
          ? session.url.trim()
          : undefined

      updateJob(jobId, {
        status: 'success',
        message: `Implementation Request started. ${formatSessionReference(session)}`,
        retryable: false,
        retryPrompt: undefined,
        sessionUrl,
      })
      updateAction(actionId, { outcome: 'success' })
      setRepoRequestPrompt('')

      if (session.session_id) {
        void pollDevinSessionForPrUrl(session.session_id, jobId)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create Devin session.'
      updateJob(jobId, {
        status: 'failed',
        message: `Implementation Request failed: ${message}`,
        retryable: true,
      })
      updateAction(actionId, { outcome: 'failed' })
      showToast('Implementation Request failed. Open Activity to retry.')
    } finally {
      setIsCreatingRepoRequest(false)
    }
  }

  const handleAssessPullRequestMergeDecision = async () => {
    if (isAssessingPullRequest) {
      return
    }

    const pr = pullRequests[0]
    if (!pr) {
      showToast('No pull requests left to assess.')
      return
    }

    const prAssessmentKey = toIssueAssessmentKey(pr)
    const existingPrAssessment = prAssessmentKey
      ? assessedPrLookup[prAssessmentKey]
      : undefined
    if (prAssessmentKey && existingPrAssessment !== undefined) {
      const existingSessionUrl =
        existingPrAssessment.sessionUrl ??
        findLatestPullRequestAssessmentSessionUrl(jobs, prAssessmentKey)

      showToast(
        existingSessionUrl
          ? 'This PR was already assessed. Use Assessment to review it.'
          : 'This PR was already assessed. Swipe to triage or skip.',
      )
      return
    }

    setIsAssessingPullRequest(true)
    const prompt = [
      `Assess pull request #${pr.id} in ${pr.repo}.`,
      'Decide whether this PR should be merged now.',
      'Return: recommendation (merge / request changes / do not merge), rationale, blocking risks, and concrete next steps.',
      'Pull request context:',
      formatCardContext(pr),
    ].join('\n\n')
    const actionId = addAction(`Assess merge decision for PR #${pr.id}`, 'pending')
    const jobId = addJob('Assess Merge Decision', `${pr.repo} #${pr.id}`, {
      retryable: true,
      retryPrompt: prompt,
    })
    showToast('Devin assessing...')

    try {
      const session = await createDevinSession(prompt, { skipCreateAsUserId: true })
      const sessionUrl =
        typeof session.url === 'string' && session.url.trim().length > 0
          ? session.url.trim()
          : undefined
      const sessionId =
        typeof session.session_id === 'string' && session.session_id.trim().length > 0
          ? session.session_id.trim()
          : toSessionIdFromSessionUrl(sessionUrl)
      updateJob(jobId, {
        status: 'success',
        message: `Merge decision assessment started. ${formatSessionReference(session)}`,
        retryable: false,
        retryPrompt: undefined,
        sessionUrl,
      })
      setAssessedPrLookup((previous) => {
        if (!prAssessmentKey) {
          return previous
        }

        const existingEntry = previous[prAssessmentKey]
        const nextEntry: AssessedIssueEntry = {
          assessedAt: existingEntry?.assessedAt ?? Date.now(),
          sessionUrl: sessionUrl ?? existingEntry?.sessionUrl,
          sessionId:
            sessionId ??
            existingEntry?.sessionId ??
            toSessionIdFromSessionUrl(sessionUrl ?? existingEntry?.sessionUrl),
        }

        if (
          existingEntry &&
          existingEntry.assessedAt === nextEntry.assessedAt &&
          existingEntry.sessionUrl === nextEntry.sessionUrl &&
          existingEntry.sessionId === nextEntry.sessionId
        ) {
          return previous
        }

        return { ...previous, [prAssessmentKey]: nextEntry }
      })
      updateAction(actionId, { outcome: 'success' })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create Devin session.'
      updateJob(jobId, {
        status: 'failed',
        message: `Assess merge decision failed: ${message}`,
        retryable: true,
      })
      updateAction(actionId, { outcome: 'failed' })
      showToast('Assess merge decision failed. Open Activity to retry.')
    } finally {
      setIsAssessingPullRequest(false)
    }
  }

  const watchMergeConflictResolution = (
    pullRequest: PullRequestCard,
    pullRequestKey: string,
) => {
    if (mergeConflictPollingLookupRef.current[pullRequestKey]) {
      return
    }

    mergeConflictPollingLookupRef.current[pullRequestKey] = true
    setMergeConflictResolutionLookup((previous) => ({
      ...previous,
      [pullRequestKey]: 'running',
    }))

    void (async () => {
      try {
        for (let attempt = 0; attempt < 36; attempt += 1) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, attempt === 0 ? 7000 : 10000)
          })

          const githubAccessToken = await resolveGithubAccessToken({ silent: true })
          const authIssue = getGithubFeedAuthIssue(githubAccessToken)
          if (authIssue) {
            throw new Error(authIssue)
          }

          const hasMergeConflict = await detectGithubPullRequestMergeConflict(
            pullRequest.repo,
            pullRequest.id,
            githubAccessToken,
          )

          if (hasMergeConflict) {
            continue
          }

          setMergeConflictLookup((previous) => {
            if (previous[pullRequestKey] === undefined) {
              return previous
            }

            const next = { ...previous }
            delete next[pullRequestKey]
            return next
          })
          setMergeConflictResolutionLookup((previous) => ({
            ...previous,
            [pullRequestKey]: 'resolved',
          }))
          return
        }

        setMergeConflictResolutionLookup((previous) => {
          if (previous[pullRequestKey] !== 'running') {
            return previous
          }

          const next = { ...previous }
          delete next[pullRequestKey]
          return next
        })
      } catch {
        setMergeConflictResolutionLookup((previous) => {
          if (previous[pullRequestKey] !== 'running') {
            return previous
          }

          const next = { ...previous }
          delete next[pullRequestKey]
          return next
        })
      } finally {
        delete mergeConflictPollingLookupRef.current[pullRequestKey]
      }
    })()
  }

  const handleMergeResolvedConflict = async () => {
    if (isMergingResolvedConflict) {
      return
    }

    const pr = activePr
    if (!pr) {
      showToast('No pull requests left to merge.')
      return
    }

    const pullRequestKey = toIssueAssessmentKey(pr)
    if (!pullRequestKey || mergeConflictResolutionLookup[pullRequestKey] !== 'resolved') {
      showToast(`Conflict is not marked as fixed for PR #${pr.id} yet.`)
      return
    }

    setIsMergingResolvedConflict(true)
    const actionId = addAction(`Merge PR #${pr.id} on GitHub`, 'pending')
    const jobId = addJob('Merge PR', `${pr.repo} #${pr.id}`)

    try {
      await mergeGithubPullRequest(pr.repo, pr.id)
      setMergeConflictLookup((previous) => {
        if (previous[pullRequestKey] === undefined) {
          return previous
        }

        const next = { ...previous }
        delete next[pullRequestKey]
        return next
      })
      setMergeConflictResolutionLookup((previous) => {
        if (previous[pullRequestKey] === undefined) {
          return previous
        }

        const next = { ...previous }
        delete next[pullRequestKey]
        return next
      })
      removeTopCard('pullRequests')
      updateJob(jobId, {
        status: 'success',
        message: `PR #${pr.id} merged on GitHub.`,
        retryable: false,
      })
      updateAction(actionId, { outcome: 'success' })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to merge pull request on GitHub.'
      const hasMergeConflict = isMergeConflictErrorMessage(message)
      if (hasMergeConflict) {
        setMergeConflictLookup((previous) => ({
          ...previous,
          [pullRequestKey]: Date.now(),
        }))
        setMergeConflictResolutionLookup((previous) => {
          if (previous[pullRequestKey] === undefined) {
            return previous
          }

          const next = { ...previous }
          delete next[pullRequestKey]
          return next
        })
      }

      updateJob(jobId, {
        status: 'failed',
        message: `Merge PR failed: ${message}`,
        retryable: false,
      })
      updateAction(actionId, { outcome: 'failed' })
      showToast(
        hasMergeConflict
          ? `PR #${pr.id} has a merge conflict again. Use Devin Fix Merge Conflict.`
          : `Failed to merge PR #${pr.id}: ${message}`,
      )
    } finally {
      setIsMergingResolvedConflict(false)
    }
  }

  const handleFixMergeConflict = async () => {
    if (isFixingMergeConflict) {
      return
    }

    const pr = activePr
    if (!pr) {
      showToast('No pull requests left to fix.')
      return
    }

    const pullRequestKey = toIssueAssessmentKey(pr)
    if (!pullRequestKey || mergeConflictLookup[pullRequestKey] === undefined) {
      showToast(`No merge conflict detected for PR #${pr.id}.`)
      return
    }

    setIsFixingMergeConflict(true)
    const prompt = [
      `Resolve merge conflicts for pull request #${pr.id} in ${pr.repo}.`,
      'Update the PR branch so it cleanly merges with the current base branch.',
      'Resolve conflicts safely, run relevant tests, and push the conflict-free branch.',
      'Share a concise summary of the conflict resolution and link to the updated PR.',
      'Pull request context:',
      formatCardContext(pr),
    ].join('\n\n')
    const actionId = addAction(`Fix merge conflict on PR #${pr.id}`, 'pending')
    const jobId = addJob('Fix Merge Conflict', `${pr.repo} #${pr.id}`, {
      retryable: true,
      retryPrompt: prompt,
    })
    showToast('Devin fixing merge conflict...')

    try {
      const session = await createDevinSession(prompt)
      const sessionUrl =
        typeof session.url === 'string' && session.url.trim().length > 0
          ? session.url.trim()
          : undefined
      updateJob(jobId, {
        status: 'success',
        message: `Merge conflict fix session started. ${formatSessionReference(session)}`,
        retryable: false,
        retryPrompt: undefined,
        sessionUrl,
      })
      updateAction(actionId, { outcome: 'success' })
      watchMergeConflictResolution(pr, pullRequestKey)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create Devin session.'
      updateJob(jobId, {
        status: 'failed',
        message: `Fix merge conflict failed: ${message}`,
        retryable: true,
      })
      updateAction(actionId, { outcome: 'failed' })
      showToast('Fix merge conflict failed. Open Activity to retry.')
    } finally {
      setIsFixingMergeConflict(false)
    }
  }

  const handleOpenCommentModal = () => {
    if (activeTab === 'issues') {
      if (!activeIssue) {
        showToast('No issues left to comment on.')
        return
      }
    } else {
      if (!activePr) {
        showToast('No pull requests left to comment on.')
        return
      }
    }

    setIsCommentModalOpen(true)
  }

  const handleTagDevinInComment = () => {
    setCommentBody((previous) => {
      const normalized = previous.trim()
      if (normalized.toLowerCase().includes(DEVIN_GITHUB_COMMENT_MENTION)) {
        return previous
      }

      if (normalized.length === 0) {
        return DEVIN_GITHUB_COMMENT_MENTION
      }

      return `${normalized}\n\n${DEVIN_GITHUB_COMMENT_MENTION}`
    })
  }

  const handleSubmitComment = async () => {
    if (!commentBody.trim()) {
      showToast('Write a short comment before submitting.')
      return
    }

    const isIssueComment = activeTab === 'issues'
    const target = isIssueComment ? activeIssue : activePr
    if (!target) {
      showToast(isIssueComment ? 'No issue available for comment.' : 'No pull request available for comment.')
      return
    }

    const kind = isIssueComment ? 'issue' : 'PR'
    const commentText = commentBody.trim()
    setIsPostingComment(true)
    setIsCommentModalOpen(false)
    setCommentBody('')
    const actionId = addAction(`Post manual comment on ${kind} #${target.id}`, 'pending')
    const jobId = addJob('Post Comment', `${target.repo} #${target.id}`, {
      retryable: true,
      retryPrompt: commentText,
    })
    showToast('Posting comment...')

    try {
      await postGithubPullRequestComment(target.repo, target.id, commentText)
      updateJob(jobId, {
        status: 'success',
        message: `Comment posted on ${kind} #${target.id}.`,
        retryable: false,
        retryPrompt: undefined,
      })
      updateAction(actionId, { outcome: 'success' })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to post comment on GitHub.'
      updateJob(jobId, {
        status: 'failed',
        message: `Post comment failed: ${message}`,
        retryable: true,
      })
      updateAction(actionId, { outcome: 'failed' })
      showToast('Comment request failed. Open Activity to retry.')
    } finally {
      setIsPostingComment(false)
    }
  }

  const handleOpenCreateIssueModal = () => {
    setCreateIssueRepo('')
    setCreateIssueRepoQuery('')
    setCreateIssueTitle('')
    setCreateIssueBody('')
    setIsCreateIssueModalOpen(true)
  }

  const handleSubmitCreateIssue = async () => {
    const repo = createIssueRepo.trim()
    if (!repo) {
      showToast('Enter a repository (e.g. owner/repo).')
      return
    }

    const title = createIssueTitle.trim()
    if (!title) {
      showToast('Enter an issue title.')
      return
    }

    setIsCreatingIssue(true)
    setIsCreateIssueModalOpen(false)
    const actionId = addAction(`Create issue on ${repo}`, 'pending')
    const jobId = addJob('Create Issue', repo)
    showToast('Creating issue...')

    try {
      const data = await createGithubIssue(repo, title, createIssueBody)
      const issueNumber = data.number
      const issueUrl = typeof data.html_url === 'string' ? data.html_url : undefined
      updateJob(jobId, {
        status: 'success',
        message: issueNumber
          ? `Issue #${issueNumber} created on ${repo}.`
          : `Issue created on ${repo}.`,
        retryable: false,
        pullRequestUrl: issueUrl,
      })
      updateAction(actionId, { outcome: 'success' })
      showToast(
        issueNumber ? `Issue #${issueNumber} created.` : 'Issue created.',
      )
      setCreateIssueRepo('')
      setCreateIssueRepoQuery('')
      setCreateIssueTitle('')
      setCreateIssueBody('')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create issue on GitHub.'
      updateJob(jobId, {
        status: 'failed',
        message: `Create issue failed: ${message}`,
      })
      updateAction(actionId, { outcome: 'failed' })
      showToast(`Failed to create issue: ${message}`)
    } finally {
      setIsCreatingIssue(false)
    }
  }

  const handleRetryJob = async (jobId: number) => {
    const job = jobs.find((entry) => entry.id === jobId)
    if (!job || job.status !== 'failed' || !job.retryable || !job.retryPrompt) {
      return
    }

    const isRetryingComment = job.label === 'Post Comment'
    updateJob(jobId, {
      status: 'running',
      message: isRetryingComment ? 'Retrying via GitHub API...' : 'Retrying with Devin API...',
      retryable: false,
    })
    const actionId = addAction(`Retry ${job.label.toLowerCase()}`, 'pending')
    showToast(isRetryingComment ? 'Retrying comment...' : `Retrying ${job.label.toLowerCase()}...`)

    try {
      if (isRetryingComment) {
        const retryTarget = parseRepoAndIssueNumberFromJobTarget(job.target)
        if (!retryTarget) {
          throw new Error('Unable to parse pull request target for comment retry.')
        }

        const retryCommentBody = extractCommentBodyFromRetryPayload(job.retryPrompt)
        await postGithubPullRequestComment(retryTarget.repo, retryTarget.id, retryCommentBody)
        updateJob(jobId, {
          status: 'success',
          message: `Retry succeeded. Comment posted on PR #${retryTarget.id}.`,
          retryable: false,
          retryPrompt: undefined,
        })
        updateAction(actionId, { outcome: 'success' })
        return
      }

      const shouldSkipCreateAsUserId =
        job.label === 'Assess Necessity' || job.label === 'Assess Merge Decision'
      const session = await createDevinSession(job.retryPrompt, {
        skipCreateAsUserId: shouldSkipCreateAsUserId,
      })
      const devinSessionUrl =
        typeof session.url === 'string' && session.url.trim().length > 0
          ? session.url.trim()
          : undefined
      const devinSessionId =
        typeof session.session_id === 'string' && session.session_id.trim().length > 0
          ? session.session_id.trim()
          : toSessionIdFromSessionUrl(devinSessionUrl)
      const reviewTarget =
        job.label === 'Review & Autofix'
          ? parseRepoAndIssueNumberFromJobTarget(job.target)
          : null
      const reviewLink = reviewTarget
        ? buildDevinReviewPullRequestUrl(reviewTarget.repo, reviewTarget.id)
        : undefined
      const sessionUrl = reviewLink ?? devinSessionUrl
      updateJob(jobId, {
        status: 'success',
        message: `Retry succeeded. ${formatSessionReference(session)}`,
        retryable: false,
        retryPrompt: undefined,
        sessionUrl,
      })
      if (job.label === 'Assess Necessity' || job.label === 'Assess Merge Decision') {
        const assessmentKey = toIssueAssessmentKeyFromJobTarget(job.target)
        const setter = job.label === 'Assess Necessity' ? setAssessedIssueLookup : setAssessedPrLookup
        if (assessmentKey) {
          setter((previous) => {
            const existingEntry = previous[assessmentKey]
            const nextEntry: AssessedIssueEntry = {
              assessedAt: existingEntry?.assessedAt ?? Date.now(),
              sessionUrl: sessionUrl ?? existingEntry?.sessionUrl,
              sessionId:
                devinSessionId ??
                existingEntry?.sessionId ??
                toSessionIdFromSessionUrl(sessionUrl ?? existingEntry?.sessionUrl),
            }

            if (
              existingEntry &&
              existingEntry.assessedAt === nextEntry.assessedAt &&
              existingEntry.sessionUrl === nextEntry.sessionUrl &&
              existingEntry.sessionId === nextEntry.sessionId
            ) {
              return previous
            }

            return { ...previous, [assessmentKey]: nextEntry }
          })
        }
      }
      updateAction(actionId, { outcome: 'success' })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to complete retry request.'
      updateJob(jobId, {
        status: 'failed',
        message: `Retry failed: ${message}`,
        retryable: true,
      })
      updateAction(actionId, { outcome: 'failed' })
      showToast(`Retry failed for ${job.label}.`)
    }
  }

  const toggleBulkMode = () => {
    setIsBulkMode((previous) => {
      if (!previous) {
        setBulkSelectedKeys(new Set())
      }
      return !previous
    })
  }

  const toggleBulkSelect = (cardKey: string) => {
    setBulkSelectedKeys((previous) => {
      const next = new Set(previous)
      if (next.has(cardKey)) {
        next.delete(cardKey)
      } else {
        next.add(cardKey)
      }
      return next
    })
  }

  const bulkSelectAll = () => {
    const deck = activeTab === 'issues' ? issues : pullRequests
    const allKeys = new Set(deck.map((card) => toIssueAssessmentKey(card)).filter((key) => key.length > 0))
    setBulkSelectedKeys(allKeys)
  }

  const bulkDeselectAll = () => {
    setBulkSelectedKeys(new Set())
  }

  const getBulkSelectedCards = (): TriageCard[] => {
    const deck: TriageCard[] = activeTab === 'issues' ? issues : pullRequests
    return deck.filter((card) => {
      const key = toIssueAssessmentKey(card)
      return key.length > 0 && bulkSelectedKeys.has(key)
    })
  }

  const handleBulkSkip = () => {
    const selectedCards = getBulkSelectedCards()
    if (selectedCards.length === 0) {
      showToast('No items selected.')
      return
    }

    const selectedKeySet = new Set(selectedCards.map((card) => toIssueAssessmentKey(card)))
    if (activeTab === 'issues') {
      setIssues((previous) => {
        const kept = previous.filter((card) => !selectedKeySet.has(toIssueAssessmentKey(card)))
        const skipped = previous.filter((card) => selectedKeySet.has(toIssueAssessmentKey(card)))
        return [...kept, ...skipped]
      })
    } else {
      setPullRequests((previous) => {
        const kept = previous.filter((card) => !selectedKeySet.has(toIssueAssessmentKey(card)))
        const skipped = previous.filter((card) => selectedKeySet.has(toIssueAssessmentKey(card)))
        return [...kept, ...skipped]
      })
    }

    const kind = activeTab === 'issues' ? 'issue' : 'PR'
    showToast(`Skipped ${selectedCards.length} ${kind}${selectedCards.length === 1 ? '' : 's'}.`)
    selectedCards.forEach((card) => {
      addAction(`Skipped ${kind} #${card.id}`, 'success')
    })
    setBulkSelectedKeys(new Set())
  }

  const handleBulkClose = async () => {
    const selectedCards = getBulkSelectedCards()
    if (selectedCards.length === 0) {
      showToast('No items selected.')
      return
    }

    setIsBulkActionRunning(true)
    const kind = activeTab === 'issues' ? 'issue' : 'PR'
    showToast(`Closing ${selectedCards.length} ${kind}${selectedCards.length === 1 ? '' : 's'}...`)

    let successCount = 0
    let failCount = 0

    for (const card of selectedCards) {
      const actionId = addAction(`Close ${kind} #${card.id} on GitHub`, 'pending')
      const jobId = addJob(`Close ${kind}`, `${card.repo} #${card.id}`)

      try {
        if (activeTab === 'issues') {
          await closeGithubIssue(card.repo, card.id)
        } else {
          await closeGithubPullRequest(card.repo, card.id)
        }
        updateJob(jobId, {
          status: 'success',
          message: `${kind} #${card.id} closed on GitHub.`,
          retryable: false,
        })
        updateAction(actionId, { outcome: 'success' })
        successCount += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unable to close ${kind} on GitHub.`
        updateJob(jobId, {
          status: 'failed',
          message: `Close ${kind} failed: ${message}`,
          retryable: false,
        })
        updateAction(actionId, { outcome: 'failed' })
        failCount += 1
      }
    }

    const selectedKeySet = new Set(selectedCards.map((card) => toIssueAssessmentKey(card)))
    if (activeTab === 'issues') {
      setIssues((previous) => previous.filter((card) => !selectedKeySet.has(toIssueAssessmentKey(card))))
    } else {
      setPullRequests((previous) => previous.filter((card) => !selectedKeySet.has(toIssueAssessmentKey(card))))
    }

    setBulkSelectedKeys(new Set())
    setIsBulkActionRunning(false)

    if (failCount === 0) {
      showToast(`Closed ${successCount} ${kind}${successCount === 1 ? '' : 's'}.`)
    } else {
      showToast(`Closed ${successCount}, failed ${failCount}. Check Activity for details.`)
    }
  }

  const handleBulkCreatePr = async () => {
    const selectedCards = getBulkSelectedCards()
    if (selectedCards.length === 0) {
      showToast('No items selected.')
      return
    }

    setIsBulkActionRunning(true)
    showToast(`Creating PRs for ${selectedCards.length} issue${selectedCards.length === 1 ? '' : 's'}...`)

    let successCount = 0
    let failCount = 0

    for (const card of selectedCards) {
      const actionId = addAction(`Create PR from issue #${card.id}`, 'pending')
      const prompt = [
        `You are triaging issue #${card.id} in repository ${card.repo}.`,
        'Create a finished pull request that resolves the issue with minimal risk and clear tests.',
        'Share the PR link plus a concise implementation summary.',
        'Issue context:',
        formatCardContext(card),
      ].join('\n\n')
      const jobId = addJob('Create PR', `${card.repo} #${card.id}`, {
        retryable: true,
        retryPrompt: prompt,
      })

      try {
        const session = await createDevinSession(prompt)
        const sessionUrl =
          typeof session.url === 'string' && session.url.trim().length > 0
            ? session.url.trim()
            : undefined
        updateJob(jobId, {
          status: 'success',
          message: `Devin session started. ${formatSessionReference(session)}`,
          retryable: false,
          retryPrompt: undefined,
          sessionUrl,
        })
        updateAction(actionId, { outcome: 'success' })
        successCount += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create Devin session.'
        updateJob(jobId, {
          status: 'failed',
          message: `Create PR request failed: ${message}`,
          retryable: true,
        })
        updateAction(actionId, { outcome: 'failed' })
        failCount += 1
      }
    }

    const selectedKeySet = new Set(selectedCards.map((card) => toIssueAssessmentKey(card)))
    setIssues((previous) => previous.filter((card) => !selectedKeySet.has(toIssueAssessmentKey(card))))
    setBulkSelectedKeys(new Set())
    setIsBulkActionRunning(false)

    if (failCount === 0) {
      showToast(`Created ${successCount} PR session${successCount === 1 ? '' : 's'}. Check Activity.`)
    } else {
      showToast(`Created ${successCount}, failed ${failCount}. Check Activity for details.`)
    }
  }

  const handleBulkMerge = async () => {
    const selectedCards = getBulkSelectedCards().filter(
      (card): card is PullRequestCard => card.kind === 'pullRequest',
    )
    if (selectedCards.length === 0) {
      showToast('No pull requests selected.')
      return
    }

    setIsBulkActionRunning(true)
    showToast(`Merging ${selectedCards.length} PR${selectedCards.length === 1 ? '' : 's'}...`)

    let mergedCount = 0
    let autoMergeCount = 0
    let failCount = 0

    for (const card of selectedCards) {
      const hasBlockingChecks = card.checks.some((check) => !check.passed)

      if (!hasBlockingChecks) {
        const actionId = addAction(`Merge PR #${card.id} on GitHub`, 'pending')
        const jobId = addJob('Merge PR', `${card.repo} #${card.id}`)

        try {
          await mergeGithubPullRequest(card.repo, card.id)
          updateJob(jobId, {
            status: 'success',
            message: `PR #${card.id} merged on GitHub.`,
            retryable: false,
          })
          updateAction(actionId, { outcome: 'success' })
          mergedCount += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to merge pull request.'
          updateJob(jobId, {
            status: 'failed',
            message: `Merge PR failed: ${message}`,
            retryable: false,
          })
          updateAction(actionId, { outcome: 'failed' })
          failCount += 1
        }
      } else {
        const actionId = addAction(`Enroll auto-merge for PR #${card.id}`, 'pending')
        const prompt = [
          `Checks are currently blocking merge for pull request #${card.id} in ${card.repo}.`,
          'Attempt auto-merge enrollment when policy permits and summarize the outcome.',
          'If enrollment is blocked, explain which permission or check is preventing it.',
          'Pull request context:',
          formatCardContext(card),
        ].join('\n\n')
        const jobId = addJob('Auto-merge enrollment', `${card.repo} #${card.id}`, {
          retryable: true,
          retryPrompt: prompt,
        })

        try {
          const session = await createDevinSession(prompt)
          updateJob(jobId, {
            status: 'success',
            message: `Auto-merge workflow started. ${formatSessionReference(session)}`,
            retryable: false,
            retryPrompt: undefined,
          })
          updateAction(actionId, { outcome: 'success' })
          autoMergeCount += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to create Devin session.'
          updateJob(jobId, {
            status: 'failed',
            message: `Auto-merge enrollment failed: ${message}`,
            retryable: true,
          })
          updateAction(actionId, { outcome: 'failed' })
          failCount += 1
        }
      }
    }

    const selectedKeySet = new Set(selectedCards.map((card) => toIssueAssessmentKey(card)))
    setPullRequests((previous) => previous.filter((card) => !selectedKeySet.has(toIssueAssessmentKey(card))))
    setBulkSelectedKeys(new Set())
    setIsBulkActionRunning(false)

    const parts: string[] = []
    if (mergedCount > 0) parts.push(`${mergedCount} merged`)
    if (autoMergeCount > 0) parts.push(`${autoMergeCount} auto-merge enrolled`)
    if (failCount > 0) parts.push(`${failCount} failed`)
    showToast(parts.join(', ') + '. Check Activity.')
  }

  const handleBulkAssess = async () => {
    const selectedCards = getBulkSelectedCards()
    if (selectedCards.length === 0) {
      showToast('No items selected.')
      return
    }

    setIsBulkActionRunning(true)
    const isIssueTab = activeTab === 'issues'
    const kind = isIssueTab ? 'issue' : 'PR'
    showToast(`Assessing ${selectedCards.length} ${kind}${selectedCards.length === 1 ? '' : 's'}...`)

    let successCount = 0
    let failCount = 0
    let skippedCount = 0

    for (const card of selectedCards) {
      const assessmentKey = toIssueAssessmentKey(card)
      const lookup = isIssueTab ? assessedIssueLookup : assessedPrLookup
      if (assessmentKey && lookup[assessmentKey] !== undefined) {
        skippedCount += 1
        continue
      }

      const prompt = isIssueTab
        ? [
            `Assess issue #${card.id} in ${card.repo}.`,
            'Decide whether the issue is actionable now. Return a verdict, rationale, and next maintainers step.',
            'Issue context:',
            formatCardContext(card),
          ].join('\n\n')
        : [
            `Assess pull request #${card.id} in ${card.repo}.`,
            'Decide whether this PR should be merged now.',
            'Return: recommendation (merge / request changes / do not merge), rationale, blocking risks, and concrete next steps.',
            'Pull request context:',
            formatCardContext(card),
          ].join('\n\n')

      const jobLabel = isIssueTab ? 'Assess Necessity' : 'Assess Merge Decision'
      const actionId = addAction(`${jobLabel} for ${kind} #${card.id}`, 'pending')
      const jobId = addJob(jobLabel, `${card.repo} #${card.id}`, {
        retryable: true,
        retryPrompt: prompt,
      })

      try {
        const session = await createDevinSession(prompt, { skipCreateAsUserId: true })
        const sessionUrl =
          typeof session.url === 'string' && session.url.trim().length > 0
            ? session.url.trim()
            : undefined
        const sessionId =
          typeof session.session_id === 'string' && session.session_id.trim().length > 0
            ? session.session_id.trim()
            : toSessionIdFromSessionUrl(sessionUrl)
        updateJob(jobId, {
          status: 'success',
          message: `Assessment session started. ${formatSessionReference(session)}`,
          retryable: false,
          retryPrompt: undefined,
          sessionUrl,
        })

        const setter = isIssueTab ? setAssessedIssueLookup : setAssessedPrLookup
        if (assessmentKey) {
          setter((previous) => ({
            ...previous,
            [assessmentKey]: {
              assessedAt: Date.now(),
              sessionUrl,
              sessionId: sessionId ?? toSessionIdFromSessionUrl(sessionUrl),
            },
          }))
        }

        updateAction(actionId, { outcome: 'success' })
        successCount += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create Devin session.'
        updateJob(jobId, {
          status: 'failed',
          message: `${jobLabel} failed: ${message}`,
          retryable: true,
        })
        updateAction(actionId, { outcome: 'failed' })
        failCount += 1
      }
    }

    setBulkSelectedKeys(new Set())
    setIsBulkActionRunning(false)

    const parts: string[] = []
    if (successCount > 0) parts.push(`${successCount} assessed`)
    if (skippedCount > 0) parts.push(`${skippedCount} already assessed`)
    if (failCount > 0) parts.push(`${failCount} failed`)
    showToast(parts.join(', ') + '. Check Activity.')
  }

  const clearLocalAppData = (options?: { showToast?: boolean }) => {
    const shouldShowToast = options?.showToast ?? true
    setAssessedIssueLookup({})
    setAssessedPrLookup({})
    setJobs([])
    setGithubSearchScope('')

    if (typeof window === 'undefined') {
      return
    }

    try {
      const keys = Object.keys(window.localStorage).filter((key) =>
        key.startsWith('minion.'),
      )
      keys.forEach((key) => window.localStorage.removeItem(key))
      if (shouldShowToast) {
        showToast(
          keys.length > 0
            ? `Cleared ${keys.length} local storage ${keys.length === 1 ? 'key' : 'keys'}.`
            : 'No local storage keys to clear.',
        )
      }
    } catch {
      if (shouldShowToast) {
        showToast('Unable to clear local storage.')
      }
    }
  }

  const handleClearSession = async () => {
    if (isClearingSession) {
      return
    }

    setIsSettingsOpen(false)
    setIsClearingSession(true)

    try {
      const devinResponse = await fetch(DEVIN_SESSION_URL, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
        credentials: 'include',
      })

      if (!devinResponse.ok && devinResponse.status !== 204) {
        throw new Error(await parseDevinError(devinResponse))
      }

      if (GITHUB_OAUTH_DISCONNECT_URL) {
        const githubResponse = await fetch(GITHUB_OAUTH_DISCONNECT_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
          },
          credentials: 'include',
        })

        if (!githubResponse.ok && githubResponse.status !== 204) {
          throw new Error(await parseDevinError(githubResponse))
        }
      }

      setHasDevinSession(false)
      setDevinApiKey(DEFAULT_DEVIN_API_KEY)
      setDevinOrgId(DEFAULT_DEVIN_ORG_ID)
      setDevinCreateAsUserId('')
      setHasVerifiedDevinConnection(false)
      setHasGithubOauthSession(false)
      setGithubOauthLogin(null)
      resetSyncedGithubFeedState()
      clearLocalAppData({ showToast: false })
      showToast('Session and local data cleared.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to clear active session.'
      showToast(`Session clear failed: ${message}`)
    } finally {
      setIsClearingSession(false)
    }
  }

  const handleTabChange = (nextTab: TabKey) => {
    if (nextTab === activeTab) {
      return
    }

    dragOffsetRef.current = { x: 0, y: 0 }
    setDragOffset({ x: 0, y: 0 })
    dragVelocityRef.current = 0
    dragVerticalVelocityRef.current = 0
    setIsDragging(false)
    setIsAnimatingOut(false)
    setSwipeDirection(null)
    setActiveTab(nextTab)
    setBulkSelectedKeys(new Set())
  }

  const handleDesktopNavTabSelect = (nextTab: TabKey) => {
    setIsDesktopActivityOpen(false)
    setIsSettingsOpen(false)
    handleTabChange(nextTab)
  }

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme
    localStorage.setItem('minion.theme', colorTheme)
  }, [colorTheme])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const desktopMedia = window.matchMedia(DESKTOP_LAYOUT_MEDIA_QUERY)
    const desktopWideMedia = window.matchMedia(DESKTOP_WIDE_LAYOUT_MEDIA_QUERY)
    const syncDesktopLayout = () => {
      setIsDesktopLayout(desktopMedia.matches)
      setIsDesktopWideLayout(desktopWideMedia.matches)
    }

    syncDesktopLayout()
    desktopMedia.addEventListener('change', syncDesktopLayout)
    desktopWideMedia.addEventListener('change', syncDesktopLayout)

    return () => {
      desktopMedia.removeEventListener('change', syncDesktopLayout)
      desktopWideMedia.removeEventListener('change', syncDesktopLayout)
    }
  }, [])

  useEffect(() => {
    if (!isDesktopLayout) {
      setIsDesktopActivityOpen(false)
      return
    }

    setIsSettingsOpen(false)
    setIsJobsOpen(false)
  }, [isDesktopLayout])

  useEffect(() => {
    if (isDesktopWideLayout) {
      setIsDesktopActivityOpen(false)
    }
  }, [isDesktopWideLayout])

  useEffect(() => {
    if (!hasActiveGithubFeed) {
      setIsDesktopActivityOpen(false)
    }
  }, [hasActiveGithubFeed])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      if (githubSearchScope.trim().length === 0) {
        window.localStorage.removeItem(GITHUB_SCOPE_STORAGE_KEY)
      } else {
        window.localStorage.setItem(GITHUB_SCOPE_STORAGE_KEY, githubSearchScope)
      }
    } catch {
      return
    }
  }, [githubSearchScope])

  useEffect(() => {
    savePersistedJobs(jobs)
  }, [jobs])

  const pollJobStatusesRef = useRef<() => Promise<void>>(async () => {})
  pollJobStatusesRef.current = async () => {
    const pollableJobs = jobs.filter(
      (job) => job.sessionUrl && !isTerminalDevinStatus(job.devinStatus),
    )

    for (const job of pollableJobs) {
      const sessionId = toSessionIdFromSessionUrl(job.sessionUrl)
      if (!sessionId) continue

      try {
        const data = await fetchDevinSessionById(sessionId)
        const nextDevinStatus = typeof data.status === 'string' ? data.status : undefined
        const nextStatusDetail =
          typeof data.status_detail === 'string' && data.status_detail.trim().length > 0
            ? data.status_detail.trim()
            : undefined
        updateJob(job.id, { devinStatus: nextDevinStatus, statusDetail: nextStatusDetail })
      } catch {
        // silently continue
      }
    }
  }

  useEffect(() => {
    if (!hasDevinSession) return

    const tick = () => {
      void pollJobStatusesRef.current?.()
    }

    const initialTimeout = window.setTimeout(tick, 5000)
    const intervalId = window.setInterval(tick, 15000)

    return () => {
      window.clearTimeout(initialTimeout)
      window.clearInterval(intervalId)
    }
  }, [hasDevinSession])

  useEffect(() => {
    if (!hasDevinSession || !hasDevinOrgId || !hasGithubOauthSession || !hasGithubScope) {
      hasAttemptedStartupSyncRef.current = false
    }
  }, [hasDevinSession, hasDevinOrgId, hasGithubOauthSession, hasGithubScope])

  useEffect(() => {
    refreshGithubOauthSessionToken({ silent: true }).finally(() =>
      setIsCheckingGithubOauthSession(false),
    )

    fetch(DEVIN_SESSION_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setHasDevinSession(true)
          const sessionOrgId =
            typeof data.orgId === 'string' && data.orgId.trim().length > 0
              ? data.orgId.trim()
              : ''
          setDevinOrgId(sessionOrgId || DEFAULT_DEVIN_ORG_ID)
          setDevinCreateAsUserId(data.createAsUserId ?? '')
          if (typeof data.githubSearchScope === 'string') {
            const serverScope = data.githubSearchScope
            setGithubSearchScope((previous) =>
              serverScope.trim().length > 0 ? serverScope : previous,
            )
          }
        }
      })
      .catch(() => {})
      .finally(() => setIsLoadingDevinSession(false))
  }, [])

  useEffect(() => {
    if (!shouldAutoSyncStartup) {
      return
    }

    hasAttemptedStartupSyncRef.current = true
    void syncGithubFeedRef.current?.({ autoTriggered: true })
  }, [shouldAutoSyncStartup])

  useEffect(() => {
    if (!isDesktopLayout || !hasActiveGithubFeed || activeTab === 'code') {
      return
    }

    const handleDesktopKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isCommentModalOpen ||
        isCreateIssueModalOpen ||
        isEditableTarget(event.target) ||
        !canTriggerDesktopSwipe
      ) {
        return
      }

      const direction: SwipeDirection | null =
        event.key === 'ArrowLeft'
          ? 'left'
          : event.key === 'ArrowRight'
            ? 'right'
            : event.key === 'ArrowDown'
              ? 'down'
              : null

      if (!direction) {
        return
      }

      event.preventDefault()
      commitSwipeRef.current(direction)
    }

    window.addEventListener('keydown', handleDesktopKeyDown)
    return () => {
      window.removeEventListener('keydown', handleDesktopKeyDown)
    }
  }, [
    activeTab,
    canTriggerDesktopSwipe,
    hasActiveGithubFeed,
    isCommentModalOpen,
    isCreateIssueModalOpen,
    isDesktopLayout,
  ])

  useEffect(() => {
    if (filteredRepoOptions.length === 0) {
      setSelectedRepo('')
      return
    }

    setSelectedRepo((previous) =>
      previous && filteredRepoOptions.includes(previous) ? previous : filteredRepoOptions[0],
    )
  }, [filteredRepoOptions])

  useEffect(() => {
    setPullRequestContentView('summary')
  }, [activePullRequestKey])

  useEffect(() => {
    if (activeTab !== 'pullRequests' || !activePr || !hasGithubOauthSession) {
      return
    }

    const pullRequestKey = toIssueAssessmentKey(activePr)
    if (!pullRequestKey) {
      return
    }

    if (pullRequestCodeLookup[pullRequestKey] !== undefined) {
      return
    }

    let isCancelled = false
    setPullRequestCodeLookup((previous) => ({
      ...previous,
      [pullRequestKey]: {
        status: 'loading',
        lines: [],
      },
    }))

    void (async () => {
      try {
        const githubAccessToken = await resolveGithubAccessToken({ silent: true })
        const authIssue = getGithubFeedAuthIssue(githubAccessToken)
        if (authIssue) {
          throw new Error(authIssue)
        }

        const files = await fetchGithubPullRequestFiles(
          activePr.repo,
          activePr.id,
          githubAccessToken,
        )

        if (isCancelled) {
          return
        }

        setPullRequestCodeLookup((previous) => ({
          ...previous,
          [pullRequestKey]: {
            status: 'ready',
            lines: toPullRequestCodeLines(files, activePr.id),
          },
        }))
      } catch (error) {
        if (isCancelled) {
          return
        }

        const message =
          error instanceof Error ? error.message : 'Unable to load pull request code.'
        setPullRequestCodeLookup((previous) => ({
          ...previous,
          [pullRequestKey]: {
            status: 'failed',
            lines: [`Unable to load pull request code: ${message}`],
          },
        }))
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [
    activePr,
    activeTab,
    hasGithubOauthSession,
  ])

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      if (Object.keys(assessedIssueLookup).length === 0) {
        window.localStorage.removeItem(ASSESSED_ISSUES_STORAGE_KEY)
        return
      }

      window.localStorage.setItem(
        ASSESSED_ISSUES_STORAGE_KEY,
        JSON.stringify(assessedIssueLookup),
      )
    } catch {
      // Ignore storage errors (quota/private mode).
    }
  }, [assessedIssueLookup])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      if (Object.keys(assessedPrLookup).length === 0) {
        window.localStorage.removeItem(ASSESSED_PRS_STORAGE_KEY)
        return
      }

      window.localStorage.setItem(
        ASSESSED_PRS_STORAGE_KEY,
        JSON.stringify(assessedPrLookup),
      )
    } catch {
      // Ignore storage errors (quota/private mode).
    }
  }, [assessedPrLookup])

  useEffect(() => {
    if (activeTab !== 'pullRequests' || !activePr) {
      return
    }

    if (!HAS_GITHUB_OAUTH_CONFIG || !hasGithubOauthSession) {
      return
    }

    const pullRequestKey = toIssueAssessmentKey(activePr)
    if (!pullRequestKey) {
      return
    }

    if (mergeConflictLookup[pullRequestKey] !== undefined) {
      return
    }

    if (mergeConflictCheckLookup[pullRequestKey] !== undefined) {
      return
    }

    let isCancelled = false
    setMergeConflictCheckLookup((previous) => ({
      ...previous,
      [pullRequestKey]: Date.now(),
    }))

    void (async () => {
      try {
        const githubAccessToken = await resolveGithubAccessToken({ silent: true })
        const authIssue = getGithubFeedAuthIssue(githubAccessToken)
        if (authIssue) {
          return
        }

        const hasMergeConflict = await detectGithubPullRequestMergeConflict(
          activePr.repo,
          activePr.id,
          githubAccessToken,
        )

        if (isCancelled || !hasMergeConflict) {
          return
        }

        setMergeConflictLookup((previous) => {
          if (previous[pullRequestKey] !== undefined) {
            return previous
          }

          return {
            ...previous,
            [pullRequestKey]: Date.now(),
          }
        })
      } catch {
        // Ignore proactive merge conflict detection failures to avoid noisy toasts.
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [
    activePr,
    activeTab,
    hasGithubOauthSession,
    mergeConflictCheckLookup,
    mergeConflictLookup,
  ])

  const swipeOutDistance =
    typeof window === 'undefined'
      ? 720
      : prefersReducedMotion
        ? Math.max(window.innerWidth * 0.8, 280)
        : Math.max(window.innerWidth, window.innerHeight) + 120
  const swipeDownOutDistance = prefersReducedMotion ? 180 : 520
  const topCardX = isAnimatingOut
    ? swipeDirection === 'left'
      ? -swipeOutDistance
      : swipeDirection === 'right'
        ? swipeOutDistance
        : 0
    : dragOffset.x

  const topCardY = isAnimatingOut
    ? swipeDirection === 'down'
      ? swipeDownOutDistance
      : dragOffset.y * 0.5
    : dragOffset.y
  const downwardOverlayDistance = Math.max(topCardY, 0)
  const horizontalOverlayDistance = Math.abs(topCardX)
  const overlayDirection: SwipeDirection =
    downwardOverlayDistance > horizontalOverlayDistance && downwardOverlayDistance > 10
      ? 'down'
      : topCardX >= 0
        ? 'right'
        : 'left'
  const overlayOpacity =
    overlayDirection === 'down'
      ? Math.min(downwardOverlayDistance / 120, 1)
      : Math.min(horizontalOverlayDistance / 130, 1)
  const showSwipeOverlay =
    overlayDirection === 'down'
      ? downwardOverlayDistance > 8
      : horizontalOverlayDistance > 8
  const overlayAction = getSwipeAction(activeTab, overlayDirection)
  const drawerBackdropTransition: Transition = prefersReducedMotion
    ? {
        type: 'tween',
        duration: 0.12,
        ease: 'easeOut',
      }
    : {
        type: 'tween',
        duration: 0.18,
        ease: 'easeOut',
      }
  const drawerPanelInitial = prefersReducedMotion
    ? { opacity: 0 }
    : { x: 24, opacity: 0.96 }
  const drawerPanelExit = prefersReducedMotion
    ? { opacity: 0 }
    : { x: 16, opacity: 0.98 }
  const drawerPanelTransition: Transition = prefersReducedMotion
    ? {
        type: 'tween',
        duration: 0.12,
        ease: 'easeOut',
      }
    : {
        type: 'spring',
        stiffness: 430,
        damping: 36,
        mass: 0.9,
      }
  const drawerPanelExitTransition: Transition = prefersReducedMotion
    ? {
        type: 'tween',
        duration: 0.1,
        ease: 'easeOut',
      }
    : {
        type: 'tween',
        duration: 0.16,
        ease: 'easeOut',
      }
  const drawerContentInitial = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 8 }
  const getDrawerContentTransition = (delay: number): Transition =>
    prefersReducedMotion
      ? {
          type: 'tween',
          duration: 0.1,
          ease: 'easeOut',
        }
      : {
          type: 'spring',
          stiffness: 360,
          damping: 34,
          mass: 0.9,
          delay,
        }
  const commentModalInitial = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 12, scale: 0.98 }
  const commentModalExit = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 10, scale: 0.985 }
  const commentModalTransition: Transition = prefersReducedMotion
    ? {
        type: 'tween',
        duration: 0.11,
        ease: 'easeOut',
      }
    : {
        type: 'spring',
        stiffness: 380,
        damping: 34,
        mass: 0.95,
      }
  const commentModalExitTransition: Transition = prefersReducedMotion
    ? {
        type: 'tween',
        duration: 0.1,
        ease: 'easeOut',
      }
    : {
        type: 'tween',
        duration: 0.16,
        ease: 'easeOut',
      }
  const desktopRailViewTransition: Transition = prefersReducedMotion
    ? {
        type: 'tween',
        duration: 0.1,
        ease: 'easeOut',
      }
    : {
        type: 'tween',
        duration: 0.18,
        ease: 'easeOut',
      }
  const desktopRailViewInitial = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 8, scale: 0.995 }
  const desktopRailViewExit = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: -6, scale: 0.995 }
  const shouldPlayStartupIntro =
    !prefersReducedMotion && shouldShowCredentialSetup && startupIntroPhase === 'playing'
  const getStartupIntroTransition = (delay: number): Transition =>
    shouldPlayStartupIntro
      ? {
          type: 'spring',
          stiffness: 350,
          damping: 34,
          mass: 0.92,
          delay,
        }
      : {
          type: 'tween',
          duration: 0.12,
          ease: 'easeOut',
        }
  const startupLoadingPanelTransition: Transition = prefersReducedMotion
    ? {
        type: 'tween',
        duration: 0.1,
        ease: 'easeOut',
      }
    : {
        type: 'spring',
        stiffness: 340,
        damping: 32,
        mass: 0.9,
      }
  const getStartupLoadingChildTransition = (delay: number): Transition =>
    prefersReducedMotion
      ? {
          type: 'tween',
          duration: 0.08,
          ease: 'easeOut',
        }
      : {
          type: 'spring',
          stiffness: 360,
          damping: 33,
          mass: 0.9,
          delay,
        }
  const pullRequestViewTransition: Transition = prefersReducedMotion
    ? {
        type: 'tween',
        duration: 0.08,
        ease: 'easeOut',
      }
    : {
        type: 'tween',
        duration: 0.16,
        ease: 'easeOut',
      }
  const pullRequestViewInitial = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 5 }
  const pullRequestViewExit = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: -4 }

  const renderStartupLoadingState = () => (
    <motion.section
      className="startup-loading-panel"
      aria-live="polite"
      aria-label="Loading feed"
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={startupLoadingPanelTransition}
    >
      <motion.div
        className="startup-skeleton-frame"
        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.995 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={getStartupLoadingChildTransition(0.07)}
      >
        <div className="skeleton-card">
          <div className="skeleton-header">
            <div className="skeleton-avatar" />
            <div className="skeleton-header-lines">
              <div className="skeleton-line skeleton-line-short" />
              <div className="skeleton-line skeleton-line-tiny" />
            </div>
          </div>

          <div className="skeleton-meta-row">
            <div className="skeleton-pill" />
            <div className="skeleton-pill skeleton-pill-wide" />
            <div className="skeleton-pill" />
          </div>

          <div className="skeleton-body">
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line-medium" />
            <div className="skeleton-line skeleton-line-long" />
            <div className="skeleton-line skeleton-line-short" />
          </div>

          <div className="skeleton-scroll-block">
            <div className="skeleton-line skeleton-line-long" />
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line-medium" />
            <div className="skeleton-line skeleton-line-long" />
            <div className="skeleton-line skeleton-line-short" />
            <div className="skeleton-line skeleton-line-medium" />
            <div className="skeleton-line" />
          </div>

          <div className="skeleton-actions-row">
            <div className="skeleton-action" />
            <div className="skeleton-action" />
          </div>
        </div>
      </motion.div>
      <motion.p
        className="skeleton-caption"
        initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={getStartupLoadingChildTransition(0.14)}
      >
        Loading...
      </motion.p>
    </motion.section>
  )

  const renderReposPanel = () => (
    <motion.section
      className="code-panel"
      aria-label="Repository pull request automation"
      initial={
        prefersReducedMotion
          ? { opacity: 0 }
          : {
              opacity: 0,
              y: 12,
              scale: 0.98,
            }
      }
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={
        prefersReducedMotion
          ? {
              type: 'tween',
              duration: 0.11,
              ease: 'easeOut',
            }
          : {
              type: 'spring',
              stiffness: 380,
              damping: 32,
              mass: 1,
            }
      }
    >
      <header className="code-panel-header">
        <h2>Repositories</h2>
        <p>
          Start with{' '}
          <a
            href="https://docs.devin.ai/onboard-devin/repo-setup#repo-setup"
            target="_blank"
            rel="noreferrer noopener"
            className="startup-tagline-link"
          >
            Devin's machine
          </a>{' '}
          or pick a repo, describe what you want built, and launch an agent that writes the code and
opens a PR.
        </p>
      </header>

      <>
        <div className="code-browser">
          <label className="repo-filter-field">
            <span>Filter repositories</span>
            <input
              type="search"
              className="repo-filter-input"
              value={repoFilterQuery}
              onChange={(event) => setRepoFilterQuery(event.target.value)}
              placeholder="Search by owner/repo"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </label>

          {filteredRepoOptions.length > 0 ? (
            <div className="code-list" role="listbox" aria-label="Available repositories">
              {filteredRepoOptions.map((repo) => {
                const isSelected = repo === selectedRepo
                const isDevinsMachine = repo === DEVINS_MACHINE_REPO_LABEL
                return (
                  <button
                    key={repo}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`repo-list-item ${isSelected ? 'is-selected' : ''} ${isDevinsMachine ? 'repo-list-item-devins-machine' : ''}`.trim()}
                    onClick={() => setSelectedRepo(repo)}
                  >
                    {isDevinsMachine ? (
                      <>
                        <img src="/devin.png" alt="" className="repo-list-devin-logo" aria-hidden="true" />
                        {repo}
                      </>
                    ) : repo}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="code-filter-empty">
              <p>
                No repositories match <span>{repoFilterQuery.trim() || 'that search'}</span>.
              </p>
            </div>
          )}
        </div>

        <form
          className="repo-request-form"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreateRepoPullRequest()
          }}
        >
          <p className="repo-request-meta">
            {selectedRepo === DEVINS_MACHINE_REPO_LABEL ? (
              <span>Using Devin's machine</span>
            ) : (
              <>
                Target repository: <span>{selectedRepo || 'Select a repository'}</span>
              </>
            )}
          </p>
          <textarea
            className="repo-request-input"
            value={repoRequestPrompt}
            onChange={(event) => setRepoRequestPrompt(event.target.value)}
            placeholder="e.g. add feature xyz and include tests"
            disabled={isCreatingRepoRequest || !selectedRepo}
            rows={4}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button
            type="submit"
            className={`fab-button primary repo-request-button ${
              !prefersReducedMotion && shipLaunchCount > 0
                ? `ship-launch-${shipLaunchCount % 2}`
                : ''
            }`.trim()}
            disabled={
              isCreatingRepoRequest || !selectedRepo || repoRequestPrompt.trim().length === 0
            }
          >
            {isCreatingRepoRequest ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Rocket size={14} aria-hidden="true" />
            )}
            <span>
              {isCreatingRepoRequest ? 'Starting Devin Session...' : 'SHIP'}
            </span>
          </button>
        </form>
      </>
    </motion.section>
  )

  const renderThemeToggleSection = (sectionClassName?: string) => (
    <div className={`theme-toggle-section ${sectionClassName ?? ''}`.trim()}>
      <div className="auth-panel-header">
        <h3>Theme</h3>
      </div>
      <div className="theme-toggle-row">
        <button
          type="button"
          className={`theme-option${colorTheme === 'dark' ? ' is-active' : ''}`}
          onClick={() => setColorTheme('dark')}
        >
          Dark
        </button>
        <button
          type="button"
          className={`theme-option${colorTheme === 'light' ? ' is-active' : ''}`}
          onClick={() => setColorTheme('light')}
        >
          Light
        </button>
        <button
          type="button"
          className={`theme-option${colorTheme === 'aurora' ? ' is-active' : ''}`}
          onClick={() => setColorTheme('aurora')}
        >
          Aurora
        </button>
        <button
          type="button"
          className={`theme-option${colorTheme === 'matrix' ? ' is-active' : ''}`}
          onClick={() => setColorTheme('matrix')}
        >
          Matrix
        </button>
      </div>
    </div>
  )

  const renderAuthPanel = (panelClassName?: string) => (
    <section
      className={`auth-panel ${panelClassName ?? ''}`.trim()}
      aria-label="Devin API authentication"
    >
      <div className="auth-inline-grid oauth-actions-grid">
        <div className="auth-panel-header">
          <h3>GitHub</h3>
          <span className={`auth-chip ${hasGithubOauthSession ? 'connected' : 'missing'}`}>
            {!HAS_GITHUB_OAUTH_CONFIG
              ? 'not configured'
              : hasGithubOauthSession
                ? 'connected'
                : 'not connected'}
          </span>
        </div>

        {hasGithubOauthSession ? (
          <label className="auth-field">
            <span>GitHub scope</span>
            <input
              type="text"
              value={githubSearchScope}
              placeholder="acme (defaults to org:acme) or user:acme"
              autoComplete="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              onChange={(event) => {
                setGithubSearchScope(event.target.value)
              }}
            />
          </label>
        ) : null}

        {hasGithubOauthSession && !isDesktopLayout ? (
          <button
            type="button"
            className="fab-button primary auth-sync-button"
            onClick={() => {
              void handleSyncGithubFeed()
            }}
            disabled={isSyncingGithubFeed || isVerifyingDevinConnection || !canSyncGithubFeed}
          >
            {isSyncingGithubFeed ? <span className="spinner" aria-hidden="true" /> : <Github size={14} />}
            <span>{isSyncingGithubFeed ? 'Refreshing Feed...' : 'Refresh Feed'}</span>
          </button>
        ) : null}

        {!hasGithubOauthSession ? (
          <button
            type="button"
            className="fab-button secondary auth-verify-button"
            onClick={handleStartGithubOauth}
            disabled={!HAS_GITHUB_OAUTH_CONFIG || isDisconnectingGithubOauthSession}
          >
            {!HAS_GITHUB_OAUTH_CONFIG ? (
              <span>GitHub OAuth Not Configured</span>
            ) : (
              <>
                <Github size={14} />
                <span>Sign In</span>
              </>
            )}
          </button>
        ) : null}

        {githubOauthLogin ? <p className="auth-note">Connected as {githubOauthLogin}.</p> : null}

        {!HAS_GITHUB_OAUTH_CONFIG ? (
          <p className="auth-note">GitHub OAuth is not configured on this server.</p>
        ) : null}

      </div>

      <div className="auth-panel-header">
        <h3>Devin</h3>
        <span
          className={`auth-chip ${
            hasVerifiedDevinConnection
              ? 'connected'
              : hasApiKey
                ? 'unverified'
                : 'missing'
          }`}
        >
          {hasVerifiedDevinConnection
            ? 'verified'
            : hasApiKey
              ? 'key loaded'
              : 'missing key'}
        </span>
      </div>

      <label className="auth-field">
        <span>Service user API key</span>
        <input
          type="password"
          value={devinApiKey}
          placeholder={hasApiKey ? 'Stored server-side (enter to replace)' : 'cog_...'}
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(event) => {
            setDevinApiKey(event.target.value)
            setHasVerifiedDevinConnection(false)
          }}
        />
      </label>
      {hasDevinSession && devinApiKey.trim().length === 0 ? (
        <p className="auth-note">Service key is saved securely. Enter a new key only to replace it.</p>
      ) : null}

      <div className="auth-inline-grid">
        <label className="auth-field auth-field-compact">
          <span>Org ID</span>
          <input
            type="text"
            value={devinOrgId}
            placeholder="org_id"
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => {
              setDevinOrgId(event.target.value)
              setHasVerifiedDevinConnection(false)
            }}
          />
        </label>

        <label className="auth-field auth-field-compact">
          <span>Create as user id (optional)</span>
          <input
            type="text"
            value={devinCreateAsUserId}
            placeholder="user_id"
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => {
              setDevinCreateAsUserId(event.target.value)
              setHasVerifiedDevinConnection(false)
            }}
          />
        </label>
      </div>

      {!hasVerifiedDevinConnection ? (
        <div className={`auth-inline-grid ${hasApiKey ? 'single-column' : ''}`.trim()}>
          <button
            type="button"
            className="fab-button secondary auth-verify-button"
            onClick={() => {
              void handleVerifyDevinConnection()
            }}
            disabled={isVerifyingDevinConnection || !hasDevinOrgId}
          >
            {isVerifyingDevinConnection ? <span className="spinner" aria-hidden="true" /> : <DevinLogo size={14} />}
            <span>Connect to Devin</span>
          </button>
          {!hasApiKey ? (
            <a
              href="https://app.devin.ai/login?prompt=empty"
              target="_blank"
              rel="noreferrer noopener"
              className="fab-button assess-button pr-assess-action auth-verify-button"
            >
              Get API Key
            </a>
          ) : null}
        </div>
      ) : null}

      {panelClassName !== 'startup-auth-panel' ? (
        <div className="auth-danger-zone">
          <div className="auth-inline-grid auth-clear-row">
            <button
              type="button"
              className="fab-button secondary auth-clear-button"
              onClick={() => {
                void handleClearSession()
              }}
              disabled={isClearingSession || isVerifyingDevinConnection || isSyncingGithubFeed}
            >
              {isClearingSession ? <span className="spinner" aria-hidden="true" /> : null}
              <span>{isClearingSession ? 'Clearing...' : 'Clear Session & Local Data'}</span>
            </button>
            {GITHUB_OAUTH_DISCONNECT_URL && hasGithubOauthSession ? (
              <button
                type="button"
                className="fab-button danger auth-clear-button"
                onClick={() => {
                  void handleDisconnectGithubOauth()
                }}
                disabled={isDisconnectingGithubOauthSession || isClearingSession}
              >
                {isDisconnectingGithubOauthSession ? <span className="spinner" aria-hidden="true" /> : null}
                <span>{isDisconnectingGithubOauthSession ? 'Signing out...' : 'Sign out'}</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )

  const renderJobsSectionContent = (options?: { closeOnLinkClick?: boolean }) => {
    const linkClickHandler = options?.closeOnLinkClick ? () => setIsJobsOpen(false) : undefined

    return (
      <>
        <div className="jobs-section-header">
          <h4>Sessions</h4>
          <span>{jobs.length}</span>
        </div>

        {jobs.length === 0 ? (
          <p className="jobs-empty">No sessions yet.</p>
        ) : (
          <ul className="jobs-list">
            {jobs.map((job) => (
              <li key={job.id} className={`job-item status-${job.status}`}>
                <div className="job-row">
                  <p className="job-label">{job.label}</p>
                  <span className={`job-status ${job.status}`}>{job.status}</span>
                </div>

                {job.devinStatus ? (
                  <div className="job-devin-status-row">
                    <span className={`job-devin-badge ${devinStatusToBadgeClass(job.devinStatus)}`}>
                      {job.devinStatus === 'running' ? (
                        <span className="badge-dot-pulse" aria-hidden="true" />
                      ) : null}
                      {formatDevinStatusLabel(job.devinStatus)}
                    </span>
                    {job.statusDetail ? (
                      <span className="job-status-detail">{job.statusDetail}</span>
                    ) : null}
                  </div>
                ) : null}

                <p className="job-target">{job.target}</p>
                <p className="job-message">{job.message}</p>

                <div className="job-meta-row">
                  <span className="job-time">{formatRelativeTime(job.createdAt)}</span>

                  <div className="job-meta-actions">
                    {job.pullRequestUrl ? (
                      <a
                        href={job.pullRequestUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="job-session-link job-pr-link"
                        onClick={linkClickHandler}
                      >
                        View PR
                      </a>
                    ) : null}

                    {job.sessionUrl ? (
                      <a
                        href={job.sessionUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="job-session-link"
                        onClick={linkClickHandler}
                      >
                        {job.label === 'Review & Autofix' ? 'Open Devin Review' : 'Open Session'}
                      </a>
                    ) : null}

                    {job.status === 'failed' && job.retryable ? (
                      <button
                        type="button"
                        className="fab-button secondary job-retry"
                        onClick={() => {
                          void handleRetryJob(job.id)
                        }}
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  const renderActivityPanelViewContent = (options?: { closeOnLinkClick?: boolean }) => (
    <section className="jobs-drawer-section" aria-label="Sessions">
      {renderJobsSectionContent(options)}
    </section>
  )

  const renderActivityPanel = (panelClassName?: string) => (
    <section
      className={`auth-panel ${panelClassName ?? ''}`.trim()}
      aria-label="Session activity"
    >
      <div className="auth-panel-header">
        <h3>Activity</h3>
      </div>
      <div className="jobs-drawer-content desktop-activity-content activity-content-single">
        {renderActivityPanelViewContent()}
      </div>
    </section>
  )

  return (
    <div className="minion-app">
      {toastMessage ? (
        <div
          className={`toast${toastUndoCallback ? ' toast-with-undo' : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="toast-message">{toastMessage}</span>
          {toastUndoCallback ? (
            <>
              <button type="button" className="toast-undo-button" onClick={toastUndoCallback}>
                Undo
              </button>
              <button
                type="button"
                className="toast-dismiss-button"
                onClick={() => {
                  setToastMessage(null)
                  setToastUndoCallback(null)
                }}
              >
                Dismiss
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <main className="app-shell">
        {hasActiveGithubFeed ? (
          <div className="stats-row" role="status" aria-label="Live counts">
            <span className="stats-cell">
              <span className="stats-value">{issues.length}</span> issues
              <span className="stats-sep">/</span>
              <span className="stats-value">{pullRequests.length}</span> PRs
            </span>
            <span className="stats-cell">
              <span className="stats-value stats-running">{runningJobsCount}</span> running
              <span className="stats-sep">/</span>
              <span className="stats-value">{completedJobsCount}</span> completed
            </span>
            <span className="stats-cell">
              <span className="stats-value">{assessedCount}</span> assessed
            </span>
          </div>
        ) : null}

        {!isDesktopLayout && hasActiveGithubFeed ? (
          <header className="top-header">
            <div className="top-toggle" aria-label="Select triage mode">
              <button
                type="button"
                className={activeTab === 'code' ? 'is-active' : ''}
                onClick={() => handleTabChange('code')}
              >
                Code
              </button>
              <button
                type="button"
                className={activeTab === 'issues' ? 'is-active' : ''}
                onClick={() => handleTabChange('issues')}
              >
                {desktopIssueCountLabel}
              </button>
              <button
                type="button"
                className={activeTab === 'pullRequests' ? 'is-active' : ''}
                onClick={() => handleTabChange('pullRequests')}
              >
                {desktopPullRequestCountLabel}
              </button>
            </div>

            <div className="top-utility-actions" aria-label="Secondary actions">
              {activeTab !== 'code' ? (
                <button
                  type="button"
                  className={`jobs-button settings-button ${isBulkMode ? 'is-active' : ''}`.trim()}
                  onClick={toggleBulkMode}
                  aria-label={isBulkMode ? 'Switch to card view' : 'Switch to bulk mode'}
                  aria-pressed={isBulkMode}
                >
                  <List size={14} />
                </button>
              ) : null}

              <button
                type="button"
                className={`jobs-button ${runningJobsCount > 0 ? 'has-running-jobs' : ''}`.trim()}
                onClick={() => setIsJobsOpen(true)}
              >
                <Activity size={14} />
                <span className="jobs-count-badge">{runningJobsCount}</span>
              </button>

              <button
                type="button"
                className="jobs-button settings-button"
                onClick={() => {
                  void handleSyncGithubFeed()
                }}
                disabled={isSyncingGithubFeed}
                aria-label={isSyncingGithubFeed ? 'Refreshing issues and pull requests' : 'Refresh issues and pull requests'}
              >
                {isSyncingGithubFeed ? <span className="spinner" aria-hidden="true" /> : <RefreshCw size={14} />}
              </button>

              {hasActiveGithubFeed ? (
                <button
                  type="button"
                  className="jobs-button settings-button"
                  onClick={() => setIsSettingsOpen(true)}
                  aria-label="Settings"
                >
                  <Settings size={14} />
                </button>
              ) : null}
            </div>
          </header>
        ) : null}

        <div
          className={`app-content-layout ${showDesktopLeftNav ? 'desktop-nav-layout' : ''} ${showDesktopSettingsPanel ? 'desktop-settings-open' : ''} ${showDesktopWideRail ? 'desktop-wide-rail' : ''}`.trim()}
        >
          {showDesktopLeftNav ? (
            <aside className="desktop-left-nav" aria-label="Desktop navigation">
              <div className="desktop-left-nav-header">
                <span className="settings-app-name">LYSIUM</span>
              </div>
              <nav className="desktop-left-nav-list" aria-label="Primary navigation">
                <button
                  type="button"
                  className={`desktop-nav-button ${!showDesktopMainActivity && activeTab === 'code' ? 'is-active' : ''}`.trim()}
                  onClick={() => handleDesktopNavTabSelect('code')}
                >
                  Code
                </button>
                <button
                  type="button"
                  className={`desktop-nav-button ${!showDesktopMainActivity && activeTab === 'issues' ? 'is-active' : ''}`.trim()}
                  onClick={() => handleDesktopNavTabSelect('issues')}
                >
                  {desktopIssueCountLabel}
                </button>
                <button
                  type="button"
                  className={`desktop-nav-button ${!showDesktopMainActivity && activeTab === 'pullRequests' ? 'is-active' : ''}`.trim()}
                  onClick={() => handleDesktopNavTabSelect('pullRequests')}
                >
                  {desktopPullRequestCountLabel}
                </button>
                {!isDesktopWideLayout ? (
                  <button
                    type="button"
                    className={`desktop-nav-button ${showDesktopMainActivity ? 'is-active' : ''}`.trim()}
                    onClick={() => {
                      setIsDesktopActivityOpen(true)
                      setIsSettingsOpen(false)
                    }}
                  >
                    Activity
                    <span className="jobs-count-badge">{runningJobsCount}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`desktop-nav-button ${isSettingsOpen ? 'is-active' : ''}`.trim()}
                  onClick={() => {
                    if (isDesktopWideLayout) {
                      setIsDesktopActivityOpen(false)
                    }
                    setIsSettingsOpen((previous) => !previous)
                  }}
                  aria-pressed={isSettingsOpen}
                >
                  Settings
                </button>
              </nav>
              {isDesktopLayout && hasActiveGithubFeed && activeTab !== 'code' && !showDesktopMainActivity ? (
                <div className="desktop-nav-swipe-actions">
                  <button
                    type="button"
                    className={`fab-button secondary desktop-swipe-button bulk-toggle-btn ${isBulkMode ? 'is-active' : ''}`}
                    onClick={toggleBulkMode}
                  >
                    <List size={16} />
                    <span>{isBulkMode ? 'Card View' : 'Bulk'}</span>
                  </button>
                  {!isBulkMode && topCard ? (
                  <>
                  <button
                    type="button"
                    className="fab-button secondary desktop-swipe-button"
                    onClick={() => commitSwipe('down')}
                  >
                    {desktopDownSwipeAction?.icon}
                    <span>{desktopDownSwipeAction?.label ?? 'Skip'}</span>
                  </button>
                  <button
                    type="button"
                    className={`fab-button desktop-swipe-button ${desktopLeftSwipeAction?.tone === 'danger' ? 'danger' : 'secondary'}`.trim()}
                    onClick={() => commitSwipe('left')}
                  >
                    {desktopLeftSwipeAction?.icon}
                    <span>{desktopLeftSwipeAction?.label ?? 'Close'}</span>
                  </button>
                  <button
                    type="button"
                    className={`fab-button desktop-swipe-button ${desktopRightSwipeAction?.tone === 'accent' ? 'assess-button pr-assess-action' : 'primary'}`.trim()}
                    onClick={() => commitSwipe('right')}
                  >
                    {desktopRightSwipeAction?.icon}
                    <span>{desktopRightSwipeAction?.label ?? 'Apply'}</span>
                  </button>
                  {activeTab === 'issues' ? (
                    <>
                      {isActiveIssueAssessed && activeIssueAssessmentSessionUrl ? (
                        <a
                          className="fab-button assess-button assessed-session-link pr-assess-action desktop-swipe-button"
                          href={activeIssueAssessmentSessionUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <DevinLogo size={16} /> <span>Assessment</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="fab-button assess-button pr-assess-action desktop-swipe-button"
                          onClick={() => void handleAssessNecessity()}
                          disabled={isAssessingIssue || isActiveIssueAssessed}
                        >
                          {isAssessingIssue ? <span className="spinner" aria-hidden="true" /> : <DevinLogo size={16} />}
                          <span>{isActiveIssueAssessed ? 'Already Assessed' : 'Assess'}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="fab-button secondary desktop-swipe-button"
                        onClick={handleOpenCommentModal}
                      >
                        <MessageSquarePlus size={16} />
                        <span>Comment</span>
                      </button>
                      <button
                        type="button"
                        className="fab-button secondary desktop-swipe-button"
                        onClick={handleOpenCreateIssueModal}
                      >
                        <Plus size={16} />
                        <span>New Issue</span>
                      </button>
                    </>
                  ) : null}
                  {activeTab === 'pullRequests' && !isActivePullRequestInMergeConflict && !isActivePullRequestConflictResolved ? (
                    <>
                      {activePullRequestReviewLink ? (
                        <a
                          className="fab-button assess-button pr-assess-action reviewed-pr-link desktop-swipe-button"
                          href={activePullRequestReviewLink}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <DevinLogo size={16} /> <span>Review</span>
                        </a>
                      ) : (
                        <button type="button" className="fab-button assess-button pr-assess-action desktop-swipe-button" disabled>
                          <DevinLogo size={16} /> <span>Review</span>
                        </button>
                      )}
                      {isActivePrAssessed && activePullRequestAssessmentSessionUrl ? (
                        <a
                          className="fab-button assess-button assessed-session-link pr-assess-action desktop-swipe-button"
                          href={activePullRequestAssessmentSessionUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          <DevinLogo size={16} /> <span>Assessment</span>
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="fab-button assess-button pr-assess-action desktop-swipe-button"
                          onClick={() => void handleAssessPullRequestMergeDecision()}
                          disabled={isAssessingPullRequest || isActivePrAssessed}
                        >
                          {isAssessingPullRequest ? <span className="spinner" aria-hidden="true" /> : <DevinLogo size={16} />}
                          <span>{isActivePrAssessed ? 'Already Assessed' : 'Assess'}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="fab-button secondary desktop-swipe-button"
                        onClick={handleOpenCommentModal}
                      >
                        <MessageSquarePlus size={16} />
                        <span>Comment</span>
                      </button>
                    </>
                  ) : null}
                  </>
                  ) : null}
                  <button
                    type="button"
                    className="fab-button secondary desktop-swipe-button desktop-nav-refresh"
                    onClick={() => void handleSyncGithubFeed()}
                    disabled={isSyncingGithubFeed}
                  >
                    {isSyncingGithubFeed
                      ? <span className="spinner" aria-hidden="true" />
                      : <RefreshCw size={16} />}
                    <span>{isSyncingGithubFeed ? 'Refreshing...' : 'Refresh Feed'}</span>
                  </button>
                </div>
              ) : null}
              <a
                href="https://github.com/dabit3/elysium"
                target="_blank"
                rel="noreferrer noopener"
                className="desktop-nav-github-link"
                aria-label="View Lysium on GitHub"
              >
                <Github size={15} />
              </a>
            </aside>
          ) : null}

          <div className="app-main-column">
            {showDesktopMainActivity ? (
              renderActivityPanel('desktop-main-activity')
            ) : (
              <>
                {!hasActiveGithubFeed ? (
                  isDesktopLayout ? (
                    <div className="startup-desktop-welcome">
                      <div className="startup-desktop-logo">
                        <motion.span
                          key={`startup-desktop-title-${startupIntroCycle}`}
                          className="settings-app-name startup-desktop-logo-text"
                          initial={
                            shouldPlayStartupIntro
                              ? { opacity: 0, y: 8, scale: 0.97 }
                              : false
                          }
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={getStartupIntroTransition(0.08)}
                        >
                          LYSIUM
                        </motion.span>
                        <motion.p
                          key={`startup-desktop-tagline-${startupIntroCycle}`}
                          className="startup-desktop-tagline"
                          initial={
                            shouldPlayStartupIntro
                              ? { opacity: 0, y: 7 }
                              : false
                          }
                          animate={{ opacity: 1, y: 0 }}
                          transition={getStartupIntroTransition(0.2)}
                        >
                          Agent-first command layer, powered by{' '}
                          <a
                            href="https://devin.ai/"
                            target="_blank"
                            rel="noreferrer noopener"
                            className="startup-tagline-link"
                          >
                            Devin
                          </a>
                        </motion.p>
                      </div>
                      <motion.div
                        key={`startup-desktop-panel-${startupIntroCycle}`}
                        className="startup-desktop-panel"
                        initial={
                          shouldPlayStartupIntro
                            ? { opacity: 0, y: 16, scale: 0.985 }
                            : false
                        }
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={getStartupIntroTransition(0.32)}
                      >
                        {showStartupLoadingState
                          ? renderStartupLoadingState()
                          : shouldShowCredentialSetup
                            ? renderAuthPanel('startup-auth-panel')
                            : null}
                      </motion.div>
                    </div>
                  ) : (
                    <section className="startup-shell deck-shell">
                      <div className="startup-mobile-welcome">
                        <div className="startup-desktop-logo">
                          <motion.span
                            key={`startup-mobile-title-${startupIntroCycle}`}
                            className="settings-app-name startup-mobile-logo-text"
                            initial={
                              shouldPlayStartupIntro
                                ? { opacity: 0, y: 8, scale: 0.97 }
                                : false
                            }
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={getStartupIntroTransition(0.08)}
                          >
                            LYSIUM
                          </motion.span>
                          <motion.p
                            key={`startup-mobile-tagline-${startupIntroCycle}`}
                            className="startup-desktop-tagline"
                            initial={
                              shouldPlayStartupIntro
                                ? { opacity: 0, y: 7 }
                                : false
                            }
                            animate={{ opacity: 1, y: 0 }}
                            transition={getStartupIntroTransition(0.2)}
                          >
                            Agent-first command layer, powered by{' '}
                            <a
                              href="https://devin.ai/"
                              target="_blank"
                              rel="noreferrer noopener"
                              className="startup-tagline-link"
                            >
                              Devin
                            </a>
                          </motion.p>
                        </div>
                        <motion.div
                          key={`startup-mobile-panel-${startupIntroCycle}`}
                          className="startup-mobile-panel"
                          initial={
                            shouldPlayStartupIntro
                              ? { opacity: 0, y: 16, scale: 0.985 }
                              : false
                          }
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          transition={getStartupIntroTransition(0.32)}
                        >
                          {showStartupLoadingState
                            ? renderStartupLoadingState()
                            : shouldShowCredentialSetup
                              ? renderAuthPanel('startup-auth-panel')
                              : null}
                        </motion.div>
                      </div>
                    </section>
                  )
                ) : null}
      {hasActiveGithubFeed ? (
        activeTab === 'code' ? (
          <section className="deck-shell" key="tab-code">
            <div className="deck-frame">{renderReposPanel()}</div>
          </section>
        ) : isBulkMode ? (
          <section className="deck-shell bulk-mode-shell" key={`tab-${activeTab}-bulk`}>
            <div className="bulk-list-header">
              <div className="bulk-list-select-controls">
                <button
                  type="button"
                  className="fab-button secondary bulk-select-btn"
                  onClick={bulkSelectedKeys.size === activeDeck.length && activeDeck.length > 0 ? bulkDeselectAll : bulkSelectAll}
                  disabled={activeDeck.length === 0}
                >
                  {bulkSelectedKeys.size === activeDeck.length && activeDeck.length > 0
                    ? <><CheckSquare size={14} /> <span>Deselect All</span></>
                    : <><Square size={14} /> <span>Select All</span></>}
                </button>
                <span className="bulk-count-label">
                  {bulkSelectedKeys.size} of {activeDeck.length} selected
                </span>
              </div>
              <div className="bulk-action-bar">
                <button
                  type="button"
                  className="fab-button secondary bulk-action-btn"
                  onClick={handleBulkSkip}
                  disabled={bulkSelectedKeys.size === 0 || isBulkActionRunning}
                >
                  <ArrowDown size={14} /> <span>Skip</span>
                </button>
                <button
                  type="button"
                  className="fab-button danger bulk-action-btn"
                  onClick={() => { void handleBulkClose() }}
                  disabled={bulkSelectedKeys.size === 0 || isBulkActionRunning}
                >
                  <X size={14} /> <span>Close</span>
                </button>
                {activeTab === 'issues' ? (
                  <button
                    type="button"
                    className="fab-button assess-button pr-assess-action bulk-action-btn"
                    onClick={() => { void handleBulkCreatePr() }}
                    disabled={bulkSelectedKeys.size === 0 || isBulkActionRunning}
                  >
                    <DevinLogo size={14} /> <span>Create PR</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="fab-button primary bulk-action-btn"
                    onClick={() => { void handleBulkMerge() }}
                    disabled={bulkSelectedKeys.size === 0 || isBulkActionRunning}
                  >
                    <Check size={14} /> <span>Merge</span>
                  </button>
                )}
                <button
                  type="button"
                  className="fab-button assess-button pr-assess-action bulk-action-btn"
                  onClick={() => { void handleBulkAssess() }}
                  disabled={bulkSelectedKeys.size === 0 || isBulkActionRunning}
                >
                  {isBulkActionRunning ? <span className="spinner" aria-hidden="true" /> : <DevinLogo size={14} />}
                  <span>Assess</span>
                </button>
              </div>
            </div>
            <div className="bulk-list-scroll">
              {activeDeck.length === 0 ? (
                <div className="empty-state">
                  <p>
                    {activeTab === 'issues'
                      ? 'No issues left to triage.'
                      : 'No pull requests left to triage.'}
                  </p>
                </div>
              ) : (
                activeDeck.map((card) => {
                  const cardKey = toIssueAssessmentKey(card)
                  const isSelected = cardKey.length > 0 && bulkSelectedKeys.has(cardKey)
                  const normalizedRepoPath = normalizeRepoPath(card.repo)
                  const cardUrl = normalizedRepoPath
                    ? card.kind === 'issue'
                      ? `https://github.com/${normalizedRepoPath}/issues/${card.id}`
                      : `https://github.com/${normalizedRepoPath}/pull/${card.id}`
                    : 'https://github.com'

                  return (
                    <div
                      key={`bulk-${card.kind}-${card.id}-${card.repo}`}
                      className={`bulk-list-item ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => { if (cardKey.length > 0) toggleBulkSelect(cardKey) }}
                      role="checkbox"
                      aria-checked={isSelected}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (cardKey.length > 0) toggleBulkSelect(cardKey) } }}
                    >
                      <span className="bulk-checkbox" aria-hidden="true">
                        {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                      </span>
                      <div className="bulk-item-content">
                        <div className="bulk-item-header">
                          <a
                            className="repo-name"
                            href={cardUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {card.repo}#{card.id}
                          </a>
                          <span className="bulk-item-author">{card.author}</span>
                          <span className="bulk-item-timestamp">{card.timestamp}</span>
                        </div>
                        <p className="bulk-item-title">{card.title}</p>
                        {card.kind === 'issue' ? (
                          <div className="bulk-item-labels">
                            {(card as IssueCard).labels.slice(0, 3).map((label) => (
                              <span key={label} className="label-pill">{label}</span>
                            ))}
                          </div>
                        ) : (
                          <div className="bulk-item-pr-stats">
                            <span className="diff-add">+{(card as PullRequestCard).additions}</span>
                            <span className="diff-remove">-{(card as PullRequestCard).deletions}</span>
                            <span
                              className={`ci-status ${(card as PullRequestCard).checks.every((c) => c.passed) ? 'ok' : 'failed'}`}
                            >
                              {(card as PullRequestCard).checks.every((c) => c.passed) ? 'CI passing' : 'CI failing'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        ) : (
          <section className="deck-shell" key={`tab-${activeTab}`}>
            <div className="deck-frame deck-frame-swipe">
              {visibleCards.length === 0 ? (
                <div className="empty-state">
                  <p>
                    {activeTab === 'issues'
                      ? 'No issues left to triage.'
                      : 'No pull requests left to triage.'}
                  </p>
                </div>
              ) : (
                visibleCards.map((card, depth) => {
                  const isTopCard = depth === 0
                  const stackDepth = Math.min(depth, 2)
                  const baseScale = 1 - stackDepth * 0.018
                  const baseY = stackDepth * 8
                  const normalizedRepoPath = normalizeRepoPath(card.repo)
                  const cardUrl = normalizedRepoPath
                    ? card.kind === 'issue'
                      ? `https://github.com/${normalizedRepoPath}/issues/${card.id}`
                      : `https://github.com/${normalizedRepoPath}/pull/${card.id}`
                    : 'https://github.com'
                  const cardTrackingKey = toIssueAssessmentKey(card)
                  const cardHasMergeConflict =
                    card.kind === 'pullRequest' &&
                    cardTrackingKey.length > 0 &&
                    mergeConflictLookup[cardTrackingKey] !== undefined
                  const pullRequestCodeEntry =
                    card.kind === 'pullRequest' && cardTrackingKey.length > 0
                      ? pullRequestCodeLookup[cardTrackingKey]
                      : undefined
                  const shouldRenderPullRequestCode =
                    card.kind === 'pullRequest' && isTopCard && pullRequestContentView === 'code'
                  const cardBodyLines = shouldRenderPullRequestCode
                    ? pullRequestCodeEntry?.status === 'ready' || pullRequestCodeEntry?.status === 'failed'
                      ? pullRequestCodeEntry.lines
                      : ['Loading pull request code from GitHub...']
                    : card.summary
                  const markdownBlocks = buildCardMarkdownBlocks(cardBodyLines)
                  const renderMarkdownBlocks = () =>
                    markdownBlocks.map((block, blockIndex) => {
                      if (block.kind === 'code') {
                        const codeTokens = highlightCodeTokens(block.content, block.language)

                        return (
                          <pre
                            key={`${card.kind}-${card.id}-md-${blockIndex}`}
                            className="code-snippet"
                          >
                            <code>
                              {codeTokens.map((token, tokenIndex) => (
                                <span
                                  key={`${card.kind}-${card.id}-md-${blockIndex}-token-${tokenIndex}`}
                                  className={
                                    token.tone === 'plain'
                                      ? undefined
                                      : `code-token ${token.tone}`
                                  }
                                >
                                  {token.value}
                                </span>
                              ))}
                            </code>
                          </pre>
                        )
                      }

                      return (
                        <p
                          key={`${card.kind}-${card.id}-md-${blockIndex}`}
                          className={`summary-line ${block.kind === 'heading' ? 'is-heading' : ''} ${block.kind === 'bullet' ? 'is-bullet' : ''}`.trim()}
                        >
                          {block.content}
                        </p>
                      )
                    })
                  const topCardIsMoving =
                    isAnimatingOut ||
                    isDragging ||
                    Math.abs(topCardX) > 0.2 ||
                    Math.abs(topCardY) > 0.2

                  const x = isTopCard && topCardIsMoving ? topCardX : 0
                  const y = isTopCard && topCardIsMoving ? topCardY : baseY
                  const rotate =
                    !prefersReducedMotion && isTopCard && topCardIsMoving ? topCardX * 0.04 : 0
                  const scale = isTopCard ? 1 : baseScale
                  const opacity = isTopCard ? (isAnimatingOut ? 0.9 : 1) : 1 - depth * 0.15
                  const staggerDelay =
                    prefersReducedMotion || isDragging || isAnimatingOut
                      ? 0
                      : Math.min(depth * 0.04, 0.12)

                  return (
                    <motion.article
                      key={`${card.kind}-${card.id}`}
                      className={`swipe-card ${isTopCard ? 'is-top-card' : ''}`}
                      style={{ zIndex: visibleCards.length - depth, transformOrigin: 'bottom center' }}
                      initial={
                        prefersReducedMotion
                          ? false
                          : {
                              opacity: 0,
                              y: baseY + 12,
                              scale: Math.max(scale - 0.02, 0.94),
                            }
                      }
                      animate={{ x, y, rotate, scale, opacity }}
                      transition={
                        isTopCard && isAnimatingOut
                          ? prefersReducedMotion || isDesktopButtonSwipe
                            ? {
                                type: 'tween',
                                duration: swipeExitDurationMs / 1000,
                                ease: [0.4, 0, 0.2, 1],
                              }
                            : {
                                type: 'spring',
                                duration: swipeExitDurationMs / 1000,
                                bounce: 0,
                              }
                          : prefersReducedMotion
                            ? {
                                type: 'tween',
                                duration: isDragging ? 0.01 : 0.11,
                                ease: 'easeOut',
                                delay: staggerDelay,
                              }
                            : {
                                type: 'spring',
                                stiffness: isDragging ? 520 : 380,
                                damping: isDragging ? 42 : 32,
                                mass: 1,
                                delay: staggerDelay,
                              }
                      }
                      onPointerDown={isTopCard ? handlePointerDown : undefined}
                      onPointerMove={isTopCard ? handlePointerMove : undefined}
                      onPointerUp={isTopCard ? handlePointerEnd : undefined}
                      onPointerCancel={isTopCard ? handlePointerEnd : undefined}
                    >
                      {isTopCard && showSwipeOverlay ? (
                        <div
                          className={`swipe-overlay ${overlayDirection} tone-${overlayAction.tone}`}
                          style={{ opacity: overlayOpacity }}
                        >
                          <div className="overlay-chip">
                            <span>{overlayAction.icon}</span>
                            <span>{overlayAction.label}</span>
                          </div>
                        </div>
                      ) : null}

                      <header className="card-header">
                        <div className="repo-row">
                          <a
                            className="repo-name repo-name-link"
                            href={cardUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {card.repo}
                          </a>
                        </div>
                        <div className="author-row">
                          <img
                            src={card.avatarUrl}
                            alt={`${card.author} avatar`}
                            className="avatar"
                          />
                          <span>{card.author}</span>
                          <span className="dot">•</span>
                          <span>{card.timestamp}</span>
                        </div>
                      </header>

                      <h2 className="card-title">{card.title}</h2>

                      {card.kind === 'issue' ? (
                        <div className="issue-label-row">
                          {card.labels.map((label) => (
                            <span key={label} className="issue-label">
                              {label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="pr-stats-row">
                          <span className="diff-add">+{card.additions}</span>
                          <span className="diff-remove">-{card.deletions}</span>
                          {card.checks.map((check) => (
                            <span
                              key={check.label}
                              className={`check-pill ${check.passed ? 'passed' : 'pending'}`}
                            >
                              {check.passed ? '✓' : '…'} {check.label}
                            </span>
                          ))}
                          <span
                            className={`ci-status ${card.checks.every((check) => check.passed) ? 'ok' : 'failed'}`}
                          >
                            {card.checks.every((check) => check.passed)
                              ? 'CI passing'
                              : 'CI failing'}
                          </span>
                          {cardHasMergeConflict ? (
                            <span className="ci-status conflict">Merge conflict</span>
                          ) : null}
                        </div>
                      )}

                      {card.kind === 'pullRequest' && isTopCard ? (
                        <div
                          className="card-content-toggle"
                          role="tablist"
                          aria-label="Pull request content view"
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className={`card-content-toggle-button ${
                              pullRequestContentView === 'summary' ? 'is-active' : ''
                            }`.trim()}
                            onClick={() => setPullRequestContentView('summary')}
                          >
                            Comment
                          </button>
                          <button
                            type="button"
                            className={`card-content-toggle-button ${
                              pullRequestContentView === 'code' ? 'is-active' : ''
                            }`.trim()}
                            onClick={() => setPullRequestContentView('code')}
                          >
                            Code
                          </button>
                        </div>
                      ) : null}

                      <div
                        className={`card-scroll-content ${card.kind === 'issue' ? 'issue-scroll-content' : ''}`.trim()}
                      >
                        {card.kind === 'pullRequest' && isTopCard ? (
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                              key={`pull-request-content-${card.id}-${pullRequestContentView}`}
                              className="card-content-view"
                              initial={pullRequestViewInitial}
                              animate={{ opacity: 1, y: 0 }}
                              exit={pullRequestViewExit}
                              transition={pullRequestViewTransition}
                            >
                              {renderMarkdownBlocks()}
                            </motion.div>
                          </AnimatePresence>
                        ) : (
                          renderMarkdownBlocks()
                        )}
                      </div>
                    </motion.article>
                  )
                })
              )}
            </div>
          </section>
        )
      ) : null}

        {hasActiveGithubFeed && activeTab !== 'code' && !isDesktopLayout && !isBulkMode ? (
          <section className="fab-section" aria-label="Triage actions">
            {activeTab === 'issues' ? (
              <div className="fab-row issue-actions">
                {isActiveIssueAssessed && activeIssueAssessmentSessionUrl ? (
                  <a
                    className="fab-button assess-button assessed-session-link pr-assess-action"
                    href={activeIssueAssessmentSessionUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <DevinLogo size={16} /> Assessment
                  </a>
                ) : (
                  <button
                    type="button"
                    className="fab-button assess-button pr-assess-action"
                    onClick={() => {
                      void handleAssessNecessity()
                    }}
                    disabled={isAssessingIssue || isActiveIssueAssessed}
                  >
                    {isAssessingIssue ? (
                      <span className="spinner" aria-hidden="true" />
                    ) : <DevinLogo size={16} />}
                    <span>{isActiveIssueAssessed ? 'Already Assessed' : 'Assess'}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="fab-button secondary"
                  onClick={handleOpenCommentModal}
                >
                  <MessageSquarePlus size={16} /> Comment
                </button>
                <button
                  type="button"
                  className="fab-button secondary"
                  onClick={handleOpenCreateIssueModal}
                >
                  <Plus size={16} /> New Issue
                </button>
              </div>
            ) : (
              <div
              className={`fab-row pr-actions${
                isActivePullRequestInMergeConflict || isActivePullRequestConflictResolved
                  ? ' conflict-actions'
                  : ''
              }`}
            >
              {isActivePullRequestInMergeConflict ? (
                <button
                  type="button"
                  className="fab-button danger merge-conflict-button"
                  onClick={() => {
                    void handleFixMergeConflict()
                  }}
                  disabled={
                    isFixingMergeConflict || isActivePullRequestConflictResolutionRunning
                  }
                >
                  {isFixingMergeConflict || isActivePullRequestConflictResolutionRunning ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : <Play size={16} />}
                  <span>
                    {isActivePullRequestConflictResolutionRunning
                      ? 'Checking Merge Conflict Fix...'
                      : 'Devin Fix Merge Conflict'}
                  </span>
                </button>
              ) : isActivePullRequestConflictResolved ? (
                <button
                  type="button"
                  className="fab-button success merge-now-button"
                  onClick={() => {
                    void handleMergeResolvedConflict()
                  }}
                  disabled={isMergingResolvedConflict}
                >
                  {isMergingResolvedConflict ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : null}
                  <span>Conflict Fixed - Merge Now</span>
                </button>
              ) : (
                <>
                  {activePullRequestReviewLink ? (
                    <a
                      className="fab-button assess-button pr-assess-action reviewed-pr-link"
                      href={activePullRequestReviewLink}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <DevinLogo size={16} /> Review
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="fab-button assess-button pr-assess-action"
                      disabled
                    >
                      <DevinLogo size={16} /> <span>Review</span>
                    </button>
                  )}

                  {isActivePrAssessed && activePullRequestAssessmentSessionUrl ? (
                    <a
                      className="fab-button assess-button assessed-session-link pr-assess-action"
                      href={activePullRequestAssessmentSessionUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <DevinLogo size={16} /> Assessment
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="fab-button assess-button pr-assess-action"
                      onClick={() => {
                        void handleAssessPullRequestMergeDecision()
                      }}
                      disabled={isAssessingPullRequest || isActivePrAssessed}
                    >
                      {isAssessingPullRequest ? (
                        <span className="spinner" aria-hidden="true" />
                      ) : <DevinLogo size={16} />}
                      <span>{isActivePrAssessed ? 'Already Assessed' : 'Assess'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="fab-button secondary"
                    onClick={handleOpenCommentModal}
                  >
                    <MessageSquarePlus size={16} /> Comment
                  </button>
                </>
              )}
              </div>
            )}
          </section>
            ) : null}
              </>
            )}
          </div>

          {showDesktopRightRail ? (
            <aside className="desktop-side-rail" aria-label="Desktop side panel">
              <AnimatePresence mode="wait" initial={false}>
                {showDesktopSettingsPanel ? (
                  <motion.div
                    key="desktop-side-rail-settings"
                    className="desktop-side-rail-view settings-view"
                    initial={desktopRailViewInitial}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={desktopRailViewExit}
                    transition={desktopRailViewTransition}
                  >
                    {renderThemeToggleSection('desktop-theme-toggle')}
                    {renderAuthPanel('desktop-settings-panel')}
                  </motion.div>
                ) : showDesktopActivityRail ? (
                  <motion.div
                    key="desktop-side-rail-activity"
                    className="desktop-side-rail-view activity-view"
                    initial={desktopRailViewInitial}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={desktopRailViewExit}
                    transition={desktopRailViewTransition}
                  >
                    {renderActivityPanel('desktop-activity-panel')}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </aside>
          ) : null}
        </div>
      </main>

      <AnimatePresence>
        {isCommentModalOpen ? (
          <motion.div
            key="comment-modal-backdrop"
            className="modal-backdrop"
            onClick={() => setIsCommentModalOpen(false)}
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={drawerBackdropTransition}
          >
            <motion.div
              className="comment-modal"
              role="dialog"
              aria-modal="true"
              aria-label={activeTab === 'issues' ? 'Leave issue comment' : 'Leave pull request comment'}
              onClick={(event) => event.stopPropagation()}
              initial={commentModalInitial}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ ...commentModalExit, transition: commentModalExitTransition }}
              transition={commentModalTransition}
            >
              <h3>Leave Comment</h3>
              <p className="modal-caption">
                {activeTab === 'issues'
                  ? `Issue #${activeIssue?.id ?? '—'} • ${activeIssue?.repo ?? 'No active issue'}`
                  : `PR #${activePr?.id ?? '—'} • ${activePr?.repo ?? 'No active PR'}`}
              </p>

              <textarea
                value={commentBody}
                onChange={(event) => setCommentBody(event.target.value)}
                placeholder="Write a clear review comment..."
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />

              <div className="modal-tag-row">
                <button
                  type="button"
                  className="fab-button secondary modal-tag-button"
                  onClick={handleTagDevinInComment}
                  disabled={isPostingComment}
                >
                  Tag Devin
                </button>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="fab-button secondary"
                  onClick={() => setIsCommentModalOpen(false)}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="fab-button primary"
                  onClick={() => {
                    void handleSubmitComment()
                  }}
                  disabled={isPostingComment}
                >
                  {isPostingComment ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : null}
                  <span>Post Comment</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isCreateIssueModalOpen ? (
          <motion.div
            key="create-issue-modal-backdrop"
            className="modal-backdrop"
            onClick={() => setIsCreateIssueModalOpen(false)}
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={drawerBackdropTransition}
          >
            <motion.div
              className="comment-modal create-issue-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Create new issue"
              onClick={(event) => event.stopPropagation()}
              initial={commentModalInitial}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ ...commentModalExit, transition: commentModalExitTransition }}
              transition={commentModalTransition}
            >
              <h3>New Issue</h3>
              <p className="modal-caption">Create a new issue on GitHub</p>

              <input
                type="search"
                className="create-issue-input"
                value={createIssueRepoQuery}
                onChange={(event) => {
                  const nextQuery = event.target.value
                  setCreateIssueRepoQuery(nextQuery)
                  setCreateIssueRepo(nextQuery)
                }}
                placeholder="Search repository (owner/repo)"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />

              <div className="create-issue-repo-list" role="listbox" aria-label="Repository suggestions">
                {filteredCreateIssueRepos.length === 0 ? (
                  <p className="create-issue-repo-empty">No matching repositories.</p>
                ) : (
                  filteredCreateIssueRepos.map((repo) => {
                    const isSelected = normalizeRepoPath(createIssueRepo) === repo
                    return (
                      <button
                        key={repo}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`create-issue-repo-option ${isSelected ? 'is-active' : ''}`.trim()}
                        onClick={() => {
                          setCreateIssueRepo(repo)
                          setCreateIssueRepoQuery(repo)
                        }}
                      >
                        {repo}
                      </button>
                    )
                  })
                )}
              </div>

              <input
                type="text"
                className="create-issue-input"
                value={createIssueTitle}
                onChange={(event) => setCreateIssueTitle(event.target.value)}
                placeholder="Issue title"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />

              <textarea
                value={createIssueBody}
                onChange={(event) => setCreateIssueBody(event.target.value)}
                placeholder="Issue description (optional, supports Markdown)"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
              />

              <div className="modal-actions">
                <button
                  type="button"
                  className="fab-button secondary"
                  onClick={() => setIsCreateIssueModalOpen(false)}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="fab-button primary"
                  onClick={() => {
                    void handleSubmitCreateIssue()
                  }}
                  disabled={isCreatingIssue}
                >
                  {isCreatingIssue ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : null}
                  <span>Create Issue</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {!isDesktopLayout && isSettingsOpen ? (
          <motion.div
            key="settings-backdrop"
            className="drawer-backdrop"
            role="presentation"
            onClick={() => setIsSettingsOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={drawerBackdropTransition}
          >
            <motion.aside
              className="settings-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Sync and API settings"
              onClick={(event) => event.stopPropagation()}
              initial={drawerPanelInitial}
              animate={{ x: 0, opacity: 1 }}
              exit={{ ...drawerPanelExit, transition: drawerPanelExitTransition }}
              transition={drawerPanelTransition}
            >
              <motion.div
                className="jobs-drawer-header"
                initial={drawerContentInitial}
                animate={{ opacity: 1, y: 0 }}
                transition={getDrawerContentTransition(0.03)}
              >
                <div className="settings-header">
                  <span className="settings-app-name">LYSIUM</span>
                  <h3>Settings</h3>
                </div>
                <button
                  type="button"
                  className="jobs-close"
                  onClick={() => setIsSettingsOpen(false)}
                >
                  Close
                </button>
              </motion.div>

              <motion.div
                className="settings-drawer-content"
                initial={drawerContentInitial}
                animate={{ opacity: 1, y: 0 }}
                transition={getDrawerContentTransition(0.07)}
              >
                {renderThemeToggleSection()}
                {renderAuthPanel('settings-auth-panel')}
                <a
                  href="https://github.com/dabit3/elysium"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="settings-github-link"
                >
                  <Github size={14} />
                  <span>View on GitHub</span>
                </a>
              </motion.div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {!isDesktopLayout && isJobsOpen ? (
          <motion.div
            key="jobs-backdrop"
            className="drawer-backdrop"
            role="presentation"
            onClick={() => setIsJobsOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={drawerBackdropTransition}
          >
            <motion.aside
              className="jobs-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Session activity"
              onClick={(event) => event.stopPropagation()}
              initial={drawerPanelInitial}
              animate={{ x: 0, opacity: 1 }}
              exit={{ ...drawerPanelExit, transition: drawerPanelExitTransition }}
              transition={drawerPanelTransition}
            >
              <motion.div
                className="jobs-drawer-header"
                initial={drawerContentInitial}
                animate={{ opacity: 1, y: 0 }}
                transition={getDrawerContentTransition(0.03)}
              >
                <div className="jobs-drawer-header-main">
                  <h3>Activity</h3>
                </div>
                <button
                  type="button"
                  className="jobs-close"
                  onClick={() => setIsJobsOpen(false)}
                >
                  Close
                </button>
              </motion.div>

              <motion.div
                className="jobs-drawer-content activity-content-single"
                initial={drawerContentInitial}
                animate={{ opacity: 1, y: 0 }}
                transition={getDrawerContentTransition(0.07)}
              >
                {renderActivityPanelViewContent({ closeOnLinkClick: true })}
              </motion.div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export default App
