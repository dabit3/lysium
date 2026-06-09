import { describe, it, expect } from 'vitest'
import {
  normalizeCodeFenceLanguage,
  parseCodeFenceLanguage,
  tokenizeWithPattern,
  highlightCodeTokens,
} from './code-highlighting'

describe('normalizeCodeFenceLanguage', () => {
  it('normalizes TS aliases', () => {
    expect(normalizeCodeFenceLanguage('ts')).toBe('typescript')
    expect(normalizeCodeFenceLanguage('tsx')).toBe('typescript')
  })

  it('normalizes JS aliases', () => {
    expect(normalizeCodeFenceLanguage('js')).toBe('javascript')
    expect(normalizeCodeFenceLanguage('jsx')).toBe('javascript')
    expect(normalizeCodeFenceLanguage('mjs')).toBe('javascript')
  })

  it('normalizes shell aliases', () => {
    expect(normalizeCodeFenceLanguage('sh')).toBe('bash')
    expect(normalizeCodeFenceLanguage('zsh')).toBe('bash')
    expect(normalizeCodeFenceLanguage('shell')).toBe('bash')
  })

  it('normalizes python alias', () => {
    expect(normalizeCodeFenceLanguage('py')).toBe('python')
  })

  it('normalizes yaml alias', () => {
    expect(normalizeCodeFenceLanguage('yml')).toBe('yaml')
  })

  it('returns empty for empty input', () => {
    expect(normalizeCodeFenceLanguage('')).toBe('')
    expect(normalizeCodeFenceLanguage('  ')).toBe('')
  })

  it('lowercases and passes through unknown languages', () => {
    expect(normalizeCodeFenceLanguage('Rust')).toBe('rust')
    expect(normalizeCodeFenceLanguage('Go')).toBe('go')
  })
})

describe('parseCodeFenceLanguage', () => {
  it('extracts language from code fence line', () => {
    expect(parseCodeFenceLanguage('```typescript')).toBe('typescript')
    expect(parseCodeFenceLanguage('```js')).toBe('javascript')
  })

  it('handles bare code fence', () => {
    expect(parseCodeFenceLanguage('```')).toBe('')
  })

  it('ignores extra tokens after language', () => {
    expect(parseCodeFenceLanguage('```python some-file.py')).toBe('python')
  })
})

describe('tokenizeWithPattern', () => {
  it('splits source into classified tokens', () => {
    const pattern = /\d+/g
    const tokens = tokenizeWithPattern('abc 42 def', pattern, () => 'number')
    expect(tokens).toEqual([
      { value: 'abc ', tone: 'plain' },
      { value: '42', tone: 'number' },
      { value: ' def', tone: 'plain' },
    ])
  })

  it('returns single plain token for no matches', () => {
    const tokens = tokenizeWithPattern('hello', /\d+/g, () => 'number')
    expect(tokens).toEqual([{ value: 'hello', tone: 'plain' }])
  })
})

describe('highlightCodeTokens', () => {
  it('highlights JavaScript keywords', () => {
    const tokens = highlightCodeTokens('const x = 42', 'js')
    const tones = tokens.map((t) => t.tone)
    expect(tones).toContain('keyword')
    expect(tones).toContain('number')
  })

  it('highlights Python comments', () => {
    const tokens = highlightCodeTokens('# comment\nx = 1', 'python')
    expect(tokens[0].tone).toBe('comment')
  })

  it('highlights bash variables', () => {
    const tokens = highlightCodeTokens('echo $HOME', 'bash')
    const variableTokens = tokens.filter((t) => t.tone === 'variable')
    expect(variableTokens.length).toBeGreaterThan(0)
  })

  it('highlights JSON properties and values', () => {
    const tokens = highlightCodeTokens('{"key": "value", "num": 42}', 'json')
    const propertyTokens = tokens.filter((t) => t.tone === 'property')
    expect(propertyTokens.length).toBeGreaterThan(0)
  })

  it('highlights YAML literals', () => {
    const tokens = highlightCodeTokens('enabled: true', 'yaml')
    const literals = tokens.filter((t) => t.tone === 'literal')
    expect(literals.length).toBeGreaterThan(0)
  })

  it('handles diff syntax', () => {
    const tokens = highlightCodeTokens('+added\n-removed\n@@ hunk', 'diff')
    expect(tokens[0].tone).toBe('diffAdd')
    expect(tokens[1].tone).toBe('diffRemove')
    expect(tokens[2].tone).toBe('diffMeta')
  })

  it('falls back to generic highlighting for unknown languages', () => {
    const tokens = highlightCodeTokens('x = 42 // comment', 'unknown')
    const tones = tokens.map((t) => t.tone)
    expect(tones).toContain('comment')
    expect(tones).toContain('number')
  })
})
