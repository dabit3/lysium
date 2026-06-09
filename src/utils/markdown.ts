import type { GithubPullRequestFile } from '../types'
import { parseCodeFenceLanguage } from './code-highlighting'

export type CardMarkdownBlock =
  | { kind: 'heading' | 'bullet' | 'paragraph'; content: string }
  | { kind: 'code'; content: string; language: string }

export const buildCardMarkdownBlocks = (lines: string[]): CardMarkdownBlock[] => {
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

export const toPullRequestCodeLines = (files: GithubPullRequestFile[], pullNumber: number) => {
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
