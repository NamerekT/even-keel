import { describe, expect, it } from 'vitest'
import { hulyClient } from './client.js'
import { fixCodeMarks, marksNote, type HulyMarkdown } from './marks.js'

const markdown = hulyClient.require<HulyMarkdown>('@hcengineering/text-markdown')

interface Node {
  type: string
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: Node[]
}

/** Every text node that would break Huly's editor: a code mark beside any other. */
function broken(text: string): string[] {
  const found: string[] = []
  const walk = (node: Node) => {
    if (node.type === 'text' && node.marks?.some((mark) => mark.type === 'code') && node.marks.length > 1) found.push(node.text ?? '')
    node.content?.forEach(walk)
  }
  walk(markdown.markdownToMarkup(text) as Node)
  return found
}

const hrefs = (text: string): string[] => {
  const found: string[] = []
  const walk = (node: Node) => {
    for (const mark of node.marks ?? []) if (mark.type === 'link') found.push(String(mark.attrs?.href))
    node.content?.forEach(walk)
  }
  walk(markdown.markdownToMarkup(text) as Node)
  return found
}

const fix = (text: string) => {
  const fixed = fixCodeMarks(text, markdown)
  return { text: fixed.text, note: marksNote([fixed]) }
}

describe('fixCodeMarks', () => {
  it('moves inline code out of bold, italics and strikethrough, keeping the code', () => {
    expect(broken('**text `code`**')).toEqual(['code'])
    expect(fix('**text `code`**')).toEqual({ text: '**text** `code`', note: 'fixed 1 mark: code moved out of bold' })
    expect(fix('_it `c`_ and ~~s `t`~~')).toEqual({ text: '_it_ `c` and ~~s~~ `t`', note: 'fixed 2 marks: code moved out of italics, strikethrough' })
    expect(fix('***x `y`*** end')).toEqual({ text: '***x*** `y` end', note: 'fixed 1 mark: code moved out of italics, bold' })
  })

  it('drops the code mark inside a link, which stays a link', () => {
    const fixed = fix('See [the `run` guide](https://example.com/guide).')
    expect(fixed).toEqual({ text: 'See [the run guide](https://example.com/guide).', note: 'fixed 1 mark: code mark removed inside a link' })
    expect(hrefs(fixed.text)).toEqual(['https://example.com/guide'])
    const bold = fix('**a [l `c`](https://example.com) b**')
    expect(bold.text).toBe('**a [l c](https://example.com) b**')
    expect(hrefs(bold.text)).toEqual(['https://example.com'])
  })

  it('leaves a text Huly can open as it was, whatever its formatting', () => {
    const clean = '* a\n* b\n\n**text** `code` and [a link](https://example.com)\n\n```\n**not `marks`**\n```\n'
    expect(fix(clean)).toEqual({ text: clean, note: null })
    expect(fix('')).toEqual({ text: '', note: null })
  })

  it('sums the fixes of several texts of one write into one line', () => {
    const parts = ['**a `b`**', '[l `c`](https://example.com)', 'clean', '_d `e`_'].map((text) => fixCodeMarks(text, markdown))
    expect(marksNote(parts)).toBe('fixed 3 marks: code moved out of bold, italics; code mark removed inside a link')
    expect(marksNote([])).toBeNull()
  })

  it('fixes marks in lists, headings and tables, keeping the edges of the text', () => {
    const text = '\n# Head **h `c`**\n\n- item **with `x`** end\n\n| A | B |\n| --- | --- |\n| **a `b`** | 2 |\n'
    const fixed = fix(text)
    expect(fixed.note).toBe('fixed 3 marks: code moved out of bold')
    expect(broken(fixed.text)).toEqual([])
    expect(fixed.text).toMatch(/^\n# Head \*\*h\*\* `c`\n\n- item \*\*with\*\* `x` end\n\n<table>/)
    expect(fixed.text.endsWith('</table>\n')).toBe(true)
  })

  it('gives a text that opens in Huly for every case at once', () => {
    const text = '**b `1`** *i `2`* ~~s `3`~~ [l `4`](https://example.com) **[n `5`](https://example.com/n)**'
    const fixed = fix(text)
    expect(broken(text)).toHaveLength(5)
    expect(broken(fixed.text)).toEqual([])
    expect(fixed.text).toContain('`1`')
    expect(fixed.text).toContain('`3`')
    expect(hrefs(fixed.text)).toEqual(['https://example.com', 'https://example.com/n'])
  })
})
