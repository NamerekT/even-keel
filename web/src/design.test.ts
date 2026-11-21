import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import baselineText from './design-baseline.json?raw'
import glueBaselineText from './glue-baseline.json?raw'
import { compareBaseline, cssViolations, violationCounts } from './ui/cssRules.js'
import { glueCounts, glueScanned, glueSpots } from './ui/glueRules.js'

// Read from the disk, not through `import.meta.glob`: vitest's module cache keeps a glob's file list from the transform
// that first ran, so a file added later would stay unseen until this test changes.
const root = fileURLToPath(new URL('.', import.meta.url))
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
// Every file of `web/src`, keyed as the baselines key it: the path under `web/src`.
const files = Object.fromEntries(walk(root).map((file) => [relative(root, file).replaceAll('\\', '/'), file]))
const read = (filter: (path: string) => boolean) =>
  Object.fromEntries(Object.keys(files).filter(filter).map((path) => [path, readFileSync(files[path]!, 'utf8')]))

const sheets = read((path) => path.endsWith('.css'))
const sources = read((path) => path.endsWith('.tsx'))
// The page code and stylesheets the glue guard reads (`glueScanned`).
const pageFiles = read(glueScanned)

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
  it('a button closes or removes with CloseIcon, never the "×" glyph that sits off its line box\'s middle', () => {
    const glyphs = Object.entries(sources).flatMap(([path, source]) =>
      [...source.matchAll(/>\s*(?:×|\{(['"`])×\1\})\s*<\/button>/g)].map((found) => `${path}:${source.slice(0, found.index).split('\n').length}`),
    )
    expect(glyphs, 'Put <CloseIcon /> of ui/icons.tsx into the button (docs/design.md, "Close")').toEqual([])
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
  it('no file glues more facts with "·" than the baseline, and the baseline is not above what is left', () => {
    const baseline = JSON.parse(glueBaselineText) as Record<string, number>
    const { more, fewer } = compareBaseline(glueCounts(pageFiles), baseline)
    const added = more.map((file) => {
      const lines = glueSpots(file, pageFiles[file] ?? '').map((spot) => `  ${file}:${spot.line} ${spot.text}`)
      return `${file}: ${lines.length} "·", the baseline allows ${baseline[file] ?? 0}\n${lines.join('\n')}`
    })
    expect(added, 'A fact glued with "·": put each value in a cell, a fact or a plaque (docs/design.md, "Facts are never glued")').toEqual([])
    expect(fewer, 'Fewer glued dots than the baseline: run `npm run design-baseline` and commit web/src/glue-baseline.json').toEqual([])
  })
})
