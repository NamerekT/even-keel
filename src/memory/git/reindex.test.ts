import { describe, expect, it } from 'vitest'
import type { MemoryFact } from '../record.js'
import { reindex } from './reindex.js'

const fact = (name: string, description: string): MemoryFact => ({ name, description, type: 'project', body: 'Body.' })

const files = (...facts: MemoryFact[]) => new Map(facts.map((each) => [`${each.name}.md`, each]))

describe('reindex', () => {
  it('drops a line the union merge doubled', () => {
    const text = '# Memory\n\n- [a](a.md) — first\n- [a](a.md) — first\n'
    expect(reindex(text, files(fact('a', 'first')))).toBe('# Memory\n\n- [a](a.md) — first\n')
  })

  it('drops the line of a file that is gone and keeps a person’s free lines', () => {
    const text = '# Memory\n\nKeep the tone short.\n- [a](a.md) — first\n- [gone](gone.md) — old\n- see [the docs](https://example.com/x.md)\n'
    expect(reindex(text, files(fact('a', 'first')))).toBe('# Memory\n\nKeep the tone short.\n- [a](a.md) — first\n- see [the docs](https://example.com/x.md)\n')
  })

  it('adds a line for a file without one, by file name', () => {
    expect(reindex('- [a](a.md) — first\n', files(fact('c', ''), fact('a', 'first'), fact('b', 'second')))).toBe(
      '- [a](a.md) — first\n- [b](b.md) — second\n- [c](c.md)\n',
    )
  })

  it('of two lines of one file keeps the one matching the frontmatter', () => {
    const text = '- [a](a.md) — old words\n- [Alpha](a.md) — new words\n- [b](b.md) — kept\n'
    expect(reindex(text, files(fact('a', 'new words'), fact('b', 'kept')))).toBe('- [Alpha](a.md) — new words\n- [b](b.md) — kept\n')
  })

  it('keeps the first line of a file when none matches its frontmatter, described anew', () => {
    const text = '- [a](a.md) — one\n- [a](a.md) — two\n'
    expect(reindex(text, files(fact('a', 'three')))).toBe('- [a](a.md) — three\n')
  })

  it('describes a line that only links to its record by the frontmatter, its link text kept', () => {
    const text = '# Memory\n- [Colour](colour.md) — the word is "teal"\n* [b](b.md) - old\n- [c](c.md)\n'
    expect(reindex(text, files(fact('colour', 'the word is "violet"'), fact('b', 'new'), fact('c', 'third')))).toBe(
      '# Memory\n- [Colour](colour.md) — the word is "violet"\n* [b](b.md) — new\n- [c](c.md) — third\n',
    )
  })

  it('drops the description of a linking line when the frontmatter has none', () => {
    expect(reindex('- [a](a.md) — old\n', files(fact('a', '')))).toBe('- [a](a.md)\n')
  })

  it('leaves a person’s line about a record as it is', () => {
    const text = 'Read [a](a.md) before b.\n- [a](a.md) and more words\n'
    expect(reindex(text, files(fact('a', 'first'), fact('b', 'second')))).toBe(
      'Read [a](a.md) before b.\n- [b](b.md) — second\n',
    )
  })

  it('keeps blank lines between sections and builds an index from nothing', () => {
    expect(reindex('# A\n\n# B\n\n', files())).toBe('# A\n\n# B\n')
    expect(reindex('', files(fact('a', 'first')))).toBe('- [a](a.md) — first\n')
    expect(reindex('', files())).toBe('')
  })
})
