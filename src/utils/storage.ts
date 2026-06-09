import {
  ASSESSED_ISSUES_RETENTION_MS,
  ASSESSED_ISSUES_STORAGE_KEY,
  ASSESSED_PRS_STORAGE_KEY,
  GITHUB_SCOPE_STORAGE_KEY,
  JOBS_STORAGE_KEY,
} from '../constants'
import type { AssessedIssueEntry, IssueCard, JobEntry } from '../types'
import { normalizeRepoPath, toSessionIdFromSessionUrl } from './formatting'

export const toIssueAssessmentKey = (issue: Pick<IssueCard, 'repo' | 'id'>) => {
  const repo = normalizeRepoPath(issue.repo).toLowerCase()
  const id = Number(issue.id)
  if (!repo || !Number.isFinite(id)) {
    return ''
  }

  return `${repo}#${Math.trunc(id)}`
}

export const parseRepoAndIssueNumberFromJobTarget = (target: string) => {
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

export const toIssueAssessmentKeyFromJobTarget = (target: string) => {
  const parsed = parseRepoAndIssueNumberFromJobTarget(target)
  if (!parsed) {
    return ''
  }

  return toIssueAssessmentKey(parsed)
}

export const toAssessedIssueEntry = (value: unknown): AssessedIssueEntry | null => {
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

export const loadPersistedJobs = (): JobEntry[] => {
  try {
    const raw = window.localStorage.getItem(JOBS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as JobEntry[]) : []
  } catch {
    return []
  }
}

export const savePersistedJobs = (jobs: JobEntry[]) => {
  try {
    window.localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(jobs))
  } catch {
    return
  }
}

export const loadAssessedIssueLookup = () => {
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

export const loadAssessedPrLookup = () => {
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

export const loadGithubSearchScope = () => {
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

export const findLatestIssueAssessmentSessionUrl = (
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

export const findLatestPullRequestAssessmentSessionUrl = (
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
