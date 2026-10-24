import { describe, expect, it } from 'vitest'
import { cssViolations, compareBaseline } from './cssRules.js'

const rules = (css: string) => cssViolations(css).map((each) => each.rule)

describe('cssViolations', () => {
  it('passes the tokens', () => {
    const css = `
.a {
  color: var(--fg);
  background: color-mix(in srgb, var(--series-1) 18%, var(--surface));
  font-size: var(--text-13);
  font-weight: 600;
  border-radius: var(--radius);
}
.b { font-size: 0.9em; font-weight: 400; border-radius: 50%; }
.c { font-size: inherit; font-weight: inherit; border-radius: 999px; }
.d { border-radius: var(--radius-control) var(--radius-control) 0 0; font: inherit; }
.e { border-radius: inherit; border-top-left-radius: var(--radius-pill); }
`
    expect(cssViolations(css)).toEqual([])
  })

  it('finds a literal colour outside :root', () => {
    expect(rules('.a { color: #fff; }')).toEqual(['colour'])
    expect(rules('.a { border: 1px solid rgb(0 0 0 / 0.2); }')).toEqual(['colour'])
    expect(rules('.a { box-shadow: 0 0 2px rgba(0, 0, 0, 0.3), 0 1px hsl(0 0% 0%); }')).toEqual(['colour', 'colour'])
    expect(rules('.a { --tint: #123456; }')).toEqual(['colour'])
  })

  it('lets :root hold colours, in a media query too', () => {
    const css = `
:root { --bg: #f4f3ef; --scrim: rgb(0 0 0 / 0.6); }
@media (prefers-color-scheme: dark) {
  :root { --bg: #141413; }
}
`
    expect(cssViolations(css)).toEqual([])
  })

  it('does not take a pseudo-element of :root for :root', () => {
    expect(rules(':root::-webkit-scrollbar { background: #000; }')).toEqual(['colour'])
  })

  it('ignores a hash in a string, a url or a comment', () => {
    const css = `
/* color: #fff; */
.a { content: '#1'; background: url("data:image/svg+xml;utf8,<svg fill='#fff'/>"); }
.b { mask: url(data:image/svg+xml;base64,AAAA) no-repeat; color: var(--fg); }
`
    expect(cssViolations(css)).toEqual([])
  })

  it('finds a font size that is not on the scale', () => {
    expect(rules('.a { font-size: 13px; }')).toEqual(['font-size'])
    expect(rules('.a { font-size: 1.2rem; }')).toEqual(['font-size'])
    expect(rules('.a { font-size: calc(var(--text-13) + 1px); }')).toEqual(['font-size'])
    expect(rules('.a { font: 600 13px/1.4 var(--font); }')).toEqual(['font-size'])
    expect(rules('.a { font: var(--text-13)/1.4 var(--mono); }')).toEqual([])
  })

  it('finds a weight other than 400 and 600', () => {
    expect(rules('.a { font-weight: 500; }')).toEqual(['font-weight'])
    expect(rules('.a { font-weight: bold; }')).toEqual(['font-weight'])
    expect(rules('.a { font: 700 var(--text-13)/1 var(--font); }')).toEqual(['font-weight'])
  })

  it('finds a radius that is not a token', () => {
    expect(rules('.a { border-radius: 4px; }')).toEqual(['radius'])
    expect(rules('.a { border-radius: calc(var(--radius) - 1px); }')).toEqual(['radius'])
    expect(rules('.a { border-top-left-radius: 6px; }')).toEqual(['radius'])
    expect(rules('.a { border-radius: var(--radius) 3px; }')).toEqual(['radius'])
  })

  it('reads nested rules and gives the line', () => {
    const css = `.a {
  color: var(--fg);

  &:hover {
    color: #fff;
  }
}`
    expect(cssViolations(css)).toEqual([{ rule: 'colour', line: 5, text: 'color: #fff' }])
  })
})

describe('compareBaseline', () => {
  it('fails a file that got more, asks to lower one that got fewer', () => {
    const found = { 'a.css': 3, 'b.css': 1, 'c.css': 2 }
    const baseline = { 'a.css': 2, 'b.css': 4, 'c.css': 2, 'gone.css': 1 }
    expect(compareBaseline(found, baseline)).toEqual({ more: ['a.css'], fewer: ['b.css', 'gone.css'] })
  })

  it('takes a file missing from the baseline as zero', () => {
    expect(compareBaseline({ 'new.css': 1 }, {})).toEqual({ more: ['new.css'], fewer: [] })
    expect(compareBaseline({ 'new.css': 0 }, {})).toEqual({ more: [], fewer: [] })
  })
})
