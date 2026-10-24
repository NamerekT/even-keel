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

describe('the design rules over web/src (docs/design.md, "Tokens")', () => {
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
