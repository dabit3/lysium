export const DEVIN_PROXY_BASE_URL = '/api/devin/proxy'
export const DEVIN_SESSION_URL = '/api/devin/session'
export const DEFAULT_DEVIN_API_KEY =
  typeof import.meta.env.VITE_DEVIN_API_KEY === 'string'
    ? import.meta.env.VITE_DEVIN_API_KEY.trim()
    : ''
export const DEFAULT_DEVIN_ORG_ID =
  typeof import.meta.env.VITE_DEVIN_ORG_ID === 'string'
    ? import.meta.env.VITE_DEVIN_ORG_ID.trim()
    : ''
export const GITHUB_OAUTH_START_URL = '/api/github/oauth/start'
export const GITHUB_OAUTH_TOKEN_URL = '/api/github/oauth/token'
export const GITHUB_OAUTH_DISCONNECT_URL = '/api/github/oauth/disconnect'
export const HAS_GITHUB_OAUTH_CONFIG = true
export const MAX_CARD_BODY_LINES = 120
export const MAX_CARD_CONTEXT_SUMMARY_LINES = 24
export const DESKTOP_LAYOUT_MEDIA_QUERY = '(min-width: 1000px)'
export const DESKTOP_WIDE_LAYOUT_MEDIA_QUERY = '(min-width: 1300px)'

export const ASSESSED_ISSUES_STORAGE_KEY = 'minion.assessed_issues.v1'
export const ASSESSED_PRS_STORAGE_KEY = 'minion.assessed_prs.v1'
export const GITHUB_SCOPE_STORAGE_KEY = 'minion.github_scope.v1'
export const DEVINS_MACHINE_REPO_LABEL = "Devin's machine"
export const DEVIN_GITHUB_COMMENT_MENTION = '@devin-ai-integration'
export const JOBS_STORAGE_KEY = 'minion.jobs.v1'

export const ASSESSED_ISSUES_RETENTION_MS = 1000 * 60 * 60 * 24 * 90

export const TERMINAL_DEVIN_STATUSES = new Set(['finished', 'stopped', 'exit', 'error'])
