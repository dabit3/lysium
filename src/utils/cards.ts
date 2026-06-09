import type { BaseCard, GithubSearchItem, IssueCard, PullRequestCard } from '../types'
import { formatFeedTimestamp, parseAgeInMinutes, toCodeSnippet, toSummaryLines } from './formatting'
import { getRepoPathFromGithubSearchItem, normalizeGithubLabels } from './github'

export const roundRobinByRepo = <T extends BaseCard>(cards: T[]) => {
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

export const mapIssueFromGithubSearchItem = (item: GithubSearchItem): IssueCard | null => {
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

export const mapPullRequestFromGithubSearchItem = (
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
