export type CodeTokenTone =
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

export interface CodeToken {
  value: string
  tone: CodeTokenTone
}

export const normalizeCodeFenceLanguage = (value: string) => {
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

export const parseCodeFenceLanguage = (line: string) => {
  const languageHint = line.replace(/^```+/, '').trim().split(/\s+/)[0] ?? ''
  return normalizeCodeFenceLanguage(languageHint)
}

export const tokenizeWithPattern = (
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

export const JS_LIKE_HIGHLIGHT_PATTERN =
  /\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|extends|new|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|interface|type|implements|public|private|protected|readonly|enum)\b|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b/gm

export const PYTHON_HIGHLIGHT_PATTERN =
  /#.*$|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:def|class|return|if|elif|else|for|while|try|except|finally|with|as|import|from|lambda|yield|async|await|pass|break|continue|raise|in|is|not|and|or|None|True|False)\b|\b\d+(?:\.\d+)?\b/gm

export const BASH_HIGHLIGHT_PATTERN =
  /#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|\b(?:if|then|fi|for|in|do|done|case|esac|function|export|local|readonly|echo|source|return|while)\b|\b\d+\b/gm

export const JSON_HIGHLIGHT_PATTERN =
  /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/gm

export const YAML_HIGHLIGHT_PATTERN =
  /^\s*#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null|yes|no|on|off)\b|-?\b\d+(?:\.\d+)?\b/gm

export const GENERIC_HIGHLIGHT_PATTERN =
  /#.*$|\/\/.*$|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b/gm

export const highlightCodeTokens = (source: string, language: string): CodeToken[] => {
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
      } as CodeToken
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
