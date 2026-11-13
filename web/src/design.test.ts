import { describe, expect, it } from 'vitest'
import baselineText from './design-baseline.json?raw'
import { compareBaseline, cssViolations, violationCounts } from './ui/cssRules.js'

// Every stylesheet of the page, keyed as the baseline keys it: the path under `web/src`.
const sheets = Object.fromEntries(
  Object.entries(import.meta.glob<string>('./**/*.css', { query: '?raw', import: 'default', eager: true })).map(([path, css]) => [
    path.replace(/^\.\//, ''),
    css,
  ]),
)

const sources = import.meta.glob<string>('./**/*.tsx', { query: '?raw', import: 'default', eager: true })

/** The lines of every `add-package__body` div of a source, matched to its closing tag by counting divs. */
function dialogBodies(source: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = []
  for (const open of source.matchAll(/<div\b[^>]*?className=["{`][^"]*\badd-package__body\b/g)) {
    const tags = /<div\b|<\/div>/g
    tags.lastIndex = open.index
    let depth = 0
    let end = source.length
    for (const tag of source.matchAll(tags)) {
      depth += tag[0] === '</div>' ? -1 : 1
      if (depth === 0) {
        end = tag.index + tag[0].length
        break
      }
    }
    const first = source.slice(0, open.index).split('\n').length
    source.slice(open.index, end).split('\n').forEach((text, index) => found.push({ line: first + index, text }))
  }
  return found
}

/** Whether a position of a source sits inside the callback of a `.map(`: an open parenthesis around it follows `map`. */
function insideMap(source: string, at: number): boolean {
  let depth = 0
  for (let index = at - 1; index >= 0; index--) {
    const char = source[index]
    if (char === ')') depth++
    else if (char === '(') {
      if (depth > 0) depth--
      else if (/\.(flat)?[mM]ap$/.test(source.slice(Math.max(0, index - 8), index))) return true
    }
  }
  return false
}

describe('the design rules over web/src (docs/design.md, "Tokens")', () => {
  it('in-flow disclosures use Fold rather than native details', () => {
    expect(Object.keys(sources).filter((path) => /<details\b/.test(sources[path]!))).toEqual([])
  })
  it('a dialog refusal sits next to its buttons, never inside the scrolling body where it can stay below the fold', () => {
    const inside = Object.entries(sources).flatMap(([path, source]) =>
      dialogBodies(source).filter(({ text }) => /\bnotice--error\b/.test(text)).map(({ line }) => `${path}:${line}`),
    )
    expect(inside, 'Put the refusal between add-package__body and the footer with class add-package__failure (docs/design.md)').toEqual([])
  })
  it('a checkbox only picks items of a list; a single on/off option is a switch', () => {
    const single = Object.entries(sources).flatMap(([path, source]) =>
      [...source.matchAll(/type="checkbox"/g)]
        .filter((found) => !insideMap(source, found.index))
        .map((found) => `${path}:${source.slice(0, found.index).split('\n').length}`),
    )
    expect(single, 'Use Switch or SwitchField of pages/settingsParts.tsx for one option (docs/design.md, "Switch")').toEqual([])
  })
  it('no stylesheet has more violations than the baseline, and the baseline is not above what is left', () => {
    const baseline = JSON.parse(baselineText) as Record<string, number>
    const { more, fewer } = compareBaseline(violationCounts(sheets), baseline)
    const added = more.map((file) => {
      const lines = cssViolations(sheets[file] ?? '').map((found) => `  ${file}:${found.line} [${found.rule}] ${found.text}`)
      return `${file}: ${lines.length}, the baseline allows ${baseline[file] ?? 0}\n${lines.join('\n')}`
    })
    expect(added, 'Use a token of web/src/styles.css :root instead of the literal value').toEqual([])
    expect(fewer, 'Fewer violations than the baseline: run `npm run design-baseline` and commit web/src/design-baseline.json').toEqual([])
  })
})
