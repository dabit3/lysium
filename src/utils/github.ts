import type { GithubPullRequestDetailsResponse, GithubSearchItem } from '../types'
import { normalizeRepoPath } from './formatting'

export const normalizeGithubScopeQualifier = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  if (trimmed.includes(':')) {
    return trimmed
  }

  return `org:${trimmed}`
}

export const getRepoPathFromGithubSearchItem = (item: GithubSearchItem) => {
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

export const normalizeGithubLabels = (labels: GithubSearchItem['labels']) => {
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

export const extractGithubOauthToken = (payload: unknown) => {
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

export const extractGithubOauthLogin = (payload: unknown) => {
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

export const detectGithubPullRequestMergeConflict = async (
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
