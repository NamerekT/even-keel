/** The token rules of `docs/design.md` that a stylesheet can be checked against: a colour only through a variable
 * (a literal only in `:root`), a font size only from the scale, two weights, a radius only from the tokens. */
export type CssRule = 'colour' | 'font-size' | 'font-weight' | 'radius'

export interface CssViolation {
  rule: CssRule
  line: number
  text: string
}

const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi
const SIZE = /^(?:var\(--text-\d+\)|\d*\.?\d+em|inherit)$/
const LENGTH = /^\d*\.?\d+(?:px|rem|pt|%)$/
const WEIGHT = /^(?:400|600|normal|inherit)$/
const RADIUS_PROPERTY = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/
const RADIUS = /^(?:0|50%|999px|inherit|var\(--radius(?:-[a-z]+)?\))$/

export function cssViolations(css: string): CssViolation[] {
  const text = withoutComments(css)
  const found: CssViolation[] = []
  const preludes: string[] = []
  let start = 0
  let depth = 0
  let quote: string | null = null
  let line = 1
  let counted = 0
  const lineAt = (index: number) => {
    for (; counted < index; counted++) if (text[counted] === '\n') line++
    return line
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quote !== null) {
      if (char === '\\') index++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && (char === '{' || char === ';' || char === '}')) {
      const segment = text.slice(start, index)
      if (char === '{') preludes.push(segment.trim())
      else {
        const lead = segment.length - segment.trimStart().length
        const inRoot = preludes.some((prelude) => prelude === ':root')
        for (const rule of declarationRules(segment.trim(), inRoot)) found.push({ rule, line: lineAt(start + lead), text: squeeze(segment) })
        if (char === '}') preludes.pop()
      }
      start = index + 1
    }
  }
  return found
}

/** Files whose count went up, and files to lower in the baseline (fewer than it says, or gone). A file the baseline lacks counts as zero. */
export function compareBaseline(found: Record<string, number>, baseline: Record<string, number>): { more: string[]; fewer: string[] } {
  const files = [...new Set([...Object.keys(found), ...Object.keys(baseline)])].sort()
  return {
    more: files.filter((file) => (found[file] ?? 0) > (baseline[file] ?? 0)),
    fewer: files.filter((file) => (found[file] ?? 0) < (baseline[file] ?? 0)),
  }
}

/** The count per file, files without a violation left out, keys sorted: the shape of the baseline file. */
export function violationCounts(sheets: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of Object.keys(sheets).sort()) {
    const count = cssViolations(sheets[file] ?? '').length
    if (count > 0) counts[file] = count
  }
  return counts
}

function declarationRules(declaration: string, inRoot: boolean): CssRule[] {
  const colon = declaration.indexOf(':')
  if (colon <= 0 || declaration.startsWith('@')) return []
  const property = declaration.slice(0, colon).trim().toLowerCase()
  const value = withoutStrings(declaration.slice(colon + 1))
    .replace(/!important\s*$/i, '')
    .trim()
  const rules: CssRule[] = []
  if (!inRoot) for (const _ of value.matchAll(COLOUR)) rules.push('colour')
  if (property === 'font-size' && !SIZE.test(value)) rules.push('font-size')
  if (property === 'font-weight' && !WEIGHT.test(value)) rules.push('font-weight')
  if (property === 'font') {
    const parts = tokens(value)
    if (parts.some((part) => LENGTH.test(part.split('/')[0] ?? ''))) rules.push('font-size')
    if (parts.some((part) => /^(?:\d+|bold|bolder|lighter)$/.test(part) && !WEIGHT.test(part))) rules.push('font-weight')
  }
  if (RADIUS_PROPERTY.test(property) && tokens(value.replaceAll('/', ' ')).some((part) => !RADIUS.test(part))) rules.push('radius')
  return rules
}

/** Splits a value at the spaces outside parentheses. */
function tokens(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth === 0 && /\s/.test(char)) {
      if (current !== '') parts.push(current)
      current = ''
    } else current += char
  }
  if (current !== '') parts.push(current)
  return parts
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
}

function withoutStrings(value: string): string {
  return value.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''").replace(/url\([^)]*\)/gi, 'url()')
}

function squeeze(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}
