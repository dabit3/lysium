export type TabKey = 'issues' | 'pullRequests' | 'code'
export type SwipeDirection = 'left' | 'right' | 'down'

export interface BaseCard {
  id: number
  repo: string
  author: string
  avatarUrl: string
  timestamp: string
  title: string
  summary: string[]
  codeSnippet: string
}

export interface IssueCard extends BaseCard {
  kind: 'issue'
  labels: string[]
}

export interface PullRequestCard extends BaseCard {
  kind: 'pullRequest'
  additions: number
  deletions: number
  checks: Array<{ label: string; passed: boolean }>
  autoMergePermissionRace?: boolean
}

export interface SwipeAction {
  label: string
  icon: React.ReactNode
  tone: 'neutral' | 'accent' | 'highlight' | 'danger'
}

export type TriageCard = IssueCard | PullRequestCard

export interface JobEntry {
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

export interface AssessedIssueEntry {
  assessedAt: number
  sessionUrl?: string
  sessionId?: string
}

export interface PullRequestCodeEntry {
  status: 'loading' | 'ready' | 'failed'
  lines: string[]
}

export interface DevinSessionPayload {
  session_id?: string
  url?: string
  status?: string
  status_detail?: string | null
  structured_output?: unknown
  [key: string]: unknown
}

export interface GithubSearchUser {
  login?: string
  avatar_url?: string
}

export interface GithubSearchItem {
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

export interface GithubSearchResponse {
  items?: GithubSearchItem[]
}

export interface GithubPullRequestDetailsResponse {
  mergeable?: boolean | null
  mergeable_state?: string | null
}

export interface GithubPullRequestFile {
  filename?: string
  status?: string
  patch?: string
  additions?: number
  deletions?: number
}
