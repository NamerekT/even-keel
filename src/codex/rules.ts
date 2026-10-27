/** A rule of Codex's own `.rules` file in the words of the Tools page: `forbidden` is `deny`, `prompt` is `ask`. */
export interface CodexRule {
  /** The command prefix, alternatives of one position in brackets: `git [push|fetch]`. */
  pattern: string
  decision: CodexDecision
}

export type CodexDecision = 'allow' | 'ask' | 'deny'

const DECISIONS: Record<string, CodexDecision> = { allow: 'allow', prompt: 'ask', forbidden: 'deny' }
const WEIGHT: CodexDecision[] = ['allow', 'ask', 'deny']

type Token = { kind: 'string'; value: string } | { kind: 'name'; value: string } | { kind: 'punct'; value: string }
type Value = string | Value[] | null

/** When several rules match a command, Codex takes the most restrictive decision. */
export function strictest(decisions: CodexDecision[]): CodexDecision | undefined {
  return decisions.reduce<CodexDecision | undefined>((found, each) => (found === undefined || WEIGHT.indexOf(each) > WEIGHT.indexOf(found) ? each : found), undefined)
}

/**
 * The `prefix_rule` calls of a Starlark `.rules` file, read without running it. A call without a readable `pattern`
 * or with an unknown `decision` is skipped; Codex defaults the decision to `allow`.
 */
export function parseCodexRules(text: string): CodexRule[] {
  const tokens = tokenize(text)
  const rules: CodexRule[] = []
  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at]!
    if (token.kind !== 'name' || token.value !== 'prefix_rule' || !isPunct(tokens[at + 1], '(')) continue
    const call = readArguments(tokens, at + 2)
    if (call === undefined) break
    at = call.end
    const pattern = call.args.pattern
    const decision = call.args.decision === undefined ? 'allow' : typeof call.args.decision === 'string' ? DECISIONS[call.args.decision] : undefined
    if (!Array.isArray(pattern) || pattern.length === 0 || decision === undefined) continue
    const words = pattern.map(wordOf)
    if (words.some((word) => word === undefined)) continue
    rules.push({ pattern: words.join(' '), decision })
  }
  return rules
}

function wordOf(value: Value): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value) || value.length === 0 || !value.every((each) => typeof each === 'string')) return undefined
  return `[${value.join('|')}]`
}

/** The keyword arguments of a call up to its closing parenthesis; `end` is the index of that parenthesis. */
function readArguments(tokens: Token[], start: number): { args: Record<string, Value>; end: number } | undefined {
  const args: Record<string, Value> = {}
  let at = start
  while (at < tokens.length) {
    const token = tokens[at]!
    if (isPunct(token, ')')) return { args, end: at }
    if (token.kind === 'name' && isPunct(tokens[at + 1], '=')) {
      const read = readValue(tokens, at + 2)
      if (read === undefined) return undefined
      args[token.value] = read.value
      at = read.next
    } else {
      const read = readValue(tokens, at)
      if (read === undefined) return undefined
      at = read.next
    }
    if (isPunct(tokens[at], ',')) at++
  }
  return undefined
}

function readValue(tokens: Token[], at: number): { value: Value; next: number } | undefined {
  const token = tokens[at]
  if (token === undefined) return undefined
  if (token.kind === 'string') return { value: token.value, next: at + 1 }
  if (isPunct(token, '[') || isPunct(token, '(')) {
    const close = token.value === '[' ? ']' : ')'
    const items: Value[] = []
    let next = at + 1
    while (!isPunct(tokens[next], close)) {
      const item = readValue(tokens, next)
      if (item === undefined) return undefined
      items.push(item.value)
      next = item.next
      if (isPunct(tokens[next], ',')) next++
    }
    return { value: items, next: next + 1 }
  }
  if (token.kind === 'name') {
    // A call or an attribute such as `host_executable(...)` in a value: not a pattern, read past it.
    let next = at + 1
    if (isPunct(tokens[next], '(')) {
      const call = readArguments(tokens, next + 1)
      if (call === undefined) return undefined
      next = call.end + 1
    }
    return { value: null, next }
  }
  if (isPunct(token, ')') || isPunct(token, ']') || isPunct(token, ',')) return undefined
  return { value: null, next: at + 1 }
}

function isPunct(token: Token | undefined, value: string): boolean {
  return token?.kind === 'punct' && token.value === value
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let at = 0
  while (at < text.length) {
    const char = text[at]!
    if (char === '#') {
      while (at < text.length && text[at] !== '\n') at++
    } else if (char === '"' || char === "'") {
      let value = ''
      at++
      while (at < text.length && text[at] !== char) {
        if (text[at] === '\\' && at + 1 < text.length) {
          const next = text[at + 1]!
          value += next === 'n' ? '\n' : next === 't' ? '\t' : next
          at += 2
        } else value += text[at++]
      }
      at++
      tokens.push({ kind: 'string', value })
    } else if (/[A-Za-z_]/.test(char)) {
      const start = at
      while (at < text.length && /\w/.test(text[at]!)) at++
      tokens.push({ kind: 'name', value: text.slice(start, at) })
    } else if (/\s/.test(char)) at++
    else tokens.push({ kind: 'punct', value: text[at++]! })
  }
  return tokens
}
