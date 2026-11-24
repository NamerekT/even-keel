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

  it('keeps the first line of a file when none matches its frontmatter', () => {
    const text = '- [a](a.md) — one\n- [a](a.md) — two\n'
    expect(reindex(text, files(fact('a', 'three')))).toBe('- [a](a.md) — one\n')
  })

  it('keeps blank lines between sections and builds an index from nothing', () => {
    expect(reindex('# A\n\n# B\n\n', files())).toBe('# A\n\n# B\n')
    expect(reindex('', files(fact('a', 'first')))).toBe('- [a](a.md) — first\n')
    expect(reindex('', files())).toBe('')
  })
})
