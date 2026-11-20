import { describe, expect, it } from 'vitest'
import { glueCounts, glueScanned, glueSpots } from './glueRules.js'

const lines = (path: string, source: string) => glueSpots(path, source).map((spot) => spot.line)

describe('glueSpots', () => {
  it('finds the dot in strings, templates, JSX text and attributes, each dot once', () => {
    const source = [
      "const a = `uncommitted · ${files}`",
      "const b = ['x', 'y'].join(' · ')",
      'const c = <span title="one · two · three">x</span>',
      'const d = <>{name} · {path}</>',
      "const e = `${a} · ${b} · ${c}`",
      "const f = 'plain'",
    ].join('\n')
    expect(lines('pages/A.tsx', source)).toEqual([1, 2, 3, 3, 4, 5, 5])
  })
  it('reads escapes as the page shows them', () => {
    expect(lines('pages/A.ts', "const a = 'x \\u00b7 y'")).toEqual([1])
  })
  it('leaves comments, JSX comments and regular expressions alone', () => {
    const source = [
      '// "Backlog · N" was the old tab',
      '/** "a · b" */',
      'const a = <div>{/* x · y */}</div>',
      'const b = /a·b/',
    ].join('\n')
    expect(lines('pages/A.tsx', source)).toEqual([])
  })
  it('finds the dot drawn by a stylesheet, not one in its comments', () => {
    const css = ["/* \"a · b\" */", ".a::before { content: '·'; }", ".b::after { content: '\\00b7'; }", ".c { content: 'x'; }"].join('\n')
    expect(lines('layout/roles.css', css)).toEqual([2, 3])
  })
  it('lets through the listed decorations by their file and text only', () => {
    expect(lines('layout/Basement.tsx', "const a = words.join('  ·  ')")).toEqual([])
    expect(lines('pages/AskPanel.tsx', "const mark = chosen ? '✓' : '·'")).toEqual([])
    expect(lines('pages/AskPanel.tsx', "const tail = `${a} · ${b}`")).toEqual([1])
    expect(lines('pages/Other.tsx', "const mark = chosen ? '✓' : '·'")).toEqual([1])
  })
})

describe('glueScanned', () => {
  it('takes the page code and stylesheets, never tests, declarations or the fake data', () => {
    expect(['pages/A.tsx', 'i18n/ci-en.ts', 'layout/roles.css'].filter(glueScanned)).toHaveLength(3)
    expect(['pages/A.test.tsx', 'ui/x.test.ts', 'vite-env.d.ts', 'live/fakeChats.ts', 'live/fake.ts', 'ui/glueRules.ts'].filter(glueScanned)).toEqual([])
  })
})

describe('glueCounts', () => {
  it('counts per file, leaves out the clean ones and sorts the keys', () => {
    expect(glueCounts({ 'b.ts': "const a = 'x · y · z'", 'a.tsx': 'const a = 1', 'c.css': ".a { content: '·' }" })).toEqual({ 'b.ts': 2, 'c.css': 1 })
  })
})
