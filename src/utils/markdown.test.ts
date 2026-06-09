import { describe, it, expect } from 'vitest'
import { buildCardMarkdownBlocks, toPullRequestCodeLines } from './markdown'

describe('buildCardMarkdownBlocks', () => {
  it('parses headings', () => {
    const blocks = buildCardMarkdownBlocks(['## Section Title'])
    expect(blocks).toEqual([{ kind: 'heading', content: 'Section Title' }])
  })

  it('parses bullet points', () => {
    const blocks = buildCardMarkdownBlocks(['- item one', '* item two'])
    expect(blocks).toEqual([
      { kind: 'bullet', content: 'item one' },
      { kind: 'bullet', content: 'item two' },
    ])
  })

  it('parses paragraphs', () => {
    const blocks = buildCardMarkdownBlocks(['plain text'])
    expect(blocks).toEqual([{ kind: 'paragraph', content: 'plain text' }])
  })

  it('parses code fences', () => {
    const blocks = buildCardMarkdownBlocks([
      '```typescript',
      'const x = 1',
      '```',
    ])
    expect(blocks).toEqual([
      { kind: 'code', content: 'const x = 1', language: 'typescript' },
    ])
  })

  it('skips blank lines', () => {
    const blocks = buildCardMarkdownBlocks(['text', '', '  ', 'more text'])
    expect(blocks).toEqual([
      { kind: 'paragraph', content: 'text' },
      { kind: 'paragraph', content: 'more text' },
    ])
  })

  it('handles unclosed code fences', () => {
    const blocks = buildCardMarkdownBlocks(['```js', 'const x = 1'])
    expect(blocks).toEqual([
      { kind: 'code', content: 'const x = 1', language: 'javascript' },
    ])
  })

  it('handles empty code fences', () => {
    const blocks = buildCardMarkdownBlocks(['```', '```'])
    expect(blocks).toEqual([])
  })

  it('handles mixed content', () => {
    const blocks = buildCardMarkdownBlocks([
      '## Title',
      'Description text',
      '- first item',
      '```python',
      'print("hi")',
      '```',
    ])
    expect(blocks).toHaveLength(4)
    expect(blocks[0].kind).toBe('heading')
    expect(blocks[1].kind).toBe('paragraph')
    expect(blocks[2].kind).toBe('bullet')
    expect(blocks[3].kind).toBe('code')
  })
})

describe('toPullRequestCodeLines', () => {
  it('returns message for empty files', () => {
    const lines = toPullRequestCodeLines([], 42)
    expect(lines).toEqual(['No changed files were returned for pull request #42.'])
  })

  it('formats file with patch', () => {
    const lines = toPullRequestCodeLines([
      {
        filename: 'src/app.ts',
        status: 'modified',
        additions: 5,
        deletions: 2,
        patch: '+new line\n-old line',
      },
    ], 1)

    expect(lines).toContain('### src/app.ts')
    expect(lines).toContain('- status: modified')
    expect(lines).toContain('- diff stats: +5 / -2')
    expect(lines).toContain('```diff')
    expect(lines).toContain('+new line\n-old line')
  })

  it('handles missing patch', () => {
    const lines = toPullRequestCodeLines([
      { filename: 'binary.png', status: 'added' },
    ], 1)

    expect(lines.join('\n')).toContain('patch unavailable')
  })

  it('handles missing filename', () => {
    const lines = toPullRequestCodeLines([
      { status: 'modified', patch: 'diff' },
    ], 1)

    expect(lines[0]).toBe('### file-1')
  })
})
