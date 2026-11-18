/**
 * Patterns in `.gitignore` syntax over paths relative to a folder, `/` between segments on every system (BTN-1315):
 * `*`, `?`, `[…]`, `**`, `\` escapes, a trailing `/` for a folder only, a slash anywhere else anchors to the root.
 * No `!`: what a pattern list keeps is another list.
 */
export interface PathRule {
  re: RegExp
  dirOnly: boolean
  /** The segments before the first one with a wildcard; `null` — the pattern matches at any depth. */
  literal: string[] | null
}

const WILD = /[*?[\\]/

export function compilePatterns(patterns: readonly string[]): PathRule[] {
  return patterns.flatMap((raw) => {
    let body = raw.trim()
    if (body === '' || body.startsWith('#')) return []
    const dirOnly = body.endsWith('/')
    if (dirOnly) body = body.replace(/\/+$/, '')
    const anchored = body.includes('/')
    body = body.replace(/^\/+/, '')
    if (body === '') return []
    const source = regexOf(body)
    const segments = body.split('/')
    const wild = segments.findIndex((segment) => WILD.test(segment))
    return [{
      re: new RegExp(anchored ? `^${source}$` : `^(?:.*/)?${source}$`),
      dirOnly,
      literal: anchored ? (wild === -1 ? segments : segments.slice(0, wild)) : null,
    }]
  })
}

/** The entry itself, its folders not looked at. */
export function matchesEntry(rules: readonly PathRule[], path: string, dir: boolean): boolean {
  return rules.some((rule) => (dir || !rule.dirOnly) && rule.re.test(path))
}

/** As git reads it: an entry matches when it or one of its folders does. */
export function matchesPath(rules: readonly PathRule[], path: string, dir: boolean): boolean {
  const segments = path.split('/')
  for (let end = 1; end < segments.length; end++) {
    if (matchesEntry(rules, segments.slice(0, end).join('/'), true)) return true
  }
  return matchesEntry(rules, path, dir)
}

/** Whether something inside the folder may match: a walk does not go into `Library` for `.temp/**`. */
export function mayHold(rules: readonly PathRule[], dir: string): boolean {
  const segments = dir.split('/')
  return rules.some(({ literal }) => {
    if (literal === null) return true
    const shared = Math.min(literal.length, segments.length)
    for (let index = 0; index < shared; index++) if (literal[index] !== segments[index]) return false
    return true
  })
}

const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

function regexOf(body: string): string {
  let out = ''
  let index = 0
  while (index < body.length) {
    const char = body[index]!
    if (char === '\\' && index + 1 < body.length) {
      out += escape(body[index + 1]!)
      index += 2
    } else if (char === '*' && body[index + 1] === '*' && (index === 0 || body[index - 1] === '/') && (body[index + 2] === '/' || index + 2 === body.length)) {
      const tail = index + 2 === body.length
      out += tail ? '.*' : '(?:.*/)?'
      index += tail ? 2 : 3
    } else if (char === '*') {
      out += '[^/]*'
      index += body[index + 1] === '*' ? 2 : 1
    } else if (char === '?') {
      out += '[^/]'
      index += 1
    } else if (char === '[') {
      const start = index + 1 + (body[index + 1] === '!' || body[index + 1] === '^' ? 1 : 0)
      const close = body.indexOf(']', start + 1)
      if (close === -1) {
        out += escape(char)
        index += 1
        continue
      }
      const negated = start !== index + 1
      out += `[${negated ? '^' : ''}${body.slice(start, close).replace(/\\/g, '\\\\')}]`
      index = close + 1
    } else {
      out += escape(char)
      index += 1
    }
  }
  return out
}
