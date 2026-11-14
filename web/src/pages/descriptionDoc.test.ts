import { describe, expect, it } from 'vitest'
import { editorMarkdown, fenceFor, previewLoss, roundTrip, toDoc } from './descriptionDoc.js'

/** Files read through Vite's glob, with Windows line ends made plain. */
const markdownFiles = (files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([path, text]) => [path, text.replace(/\r\n/g, '\n')]))

describe('fenceFor', () => {
  it('is three backticks unless the code holds a run as long', () => {
    expect(fenceFor('const a = 1')).toBe('```')
    expect(fenceFor('a `b` c')).toBe('```')
    expect(fenceFor('```js\nx\n```')).toBe('````')
    expect(fenceFor('`````')).toBe('``````')
  })
})

describe('editorMarkdown', () => {
  it('leaves no empty lines after the trailing paragraph the editor adds below a code block', () => {
    const doc = toDoc('Text\n\n```\ncode\n```')
    expect(editorMarkdown({ ...doc, content: [...doc.content!, { type: 'paragraph' }] })).toBe('Text\n\n```\ncode\n```')
  })
})

describe('the visual editor keeps what it shows', () => {
  const kept: [string, string][] = [
    ['headings and paragraphs', '# Title\n\nText.\n\n## Part\n\nMore text.'],
    ['lists with either marker', '* one\n* two\n\n1. first\n2. second\n   - nested'],
    ['a loose list', '- a\n\n- b'],
    ['task lists', '- [ ] to do\n- [x] done'],
    ['emphasis', '**bold**, _italic_, *also*, ~~struck~~'],
    ['inline code inside bold', '**see `Core` here** and **`only code`**'],
    ['inline code inside a link', '[the `fill` call](https://example.com)'],
    ['inline code with backticks', 'a ``x ` y`` b and ` ````` `'],
    ['a fenced block holding a fence', '````md\n```js\ninner\n```\n````'],
    ['a block of backticks only', '``````\n`````\n``````'],
    ['a tilde fence', '~~~\ncode\n~~~'],
    ['an indented code block', 'Text:\n\n    code here'],
    ['a table', '| a | b |\n| --- | --- |\n| 1 | `2` |'],
    ['links, autolinks and references', '[site](https://example.com "Title"), <https://example.com/x> and [ref][1]\n\n[1]: https://example.com/ref'],
    ['a quote and a rule', '> quoted\n> text\n\n---\n\nafter'],
    ['a hard break', 'line one  \nline two'],
    ['characters Markdown would read', 'a\\*b, 2 \\* 3, snake\\_case, 1\\. not a list, AT&T, x < y'],
  ]
  it.each(kept)('%s', (_, text) => {
    expect(previewLoss(text)).toBeNull()
  })

  it('writes back text it reads again the same', () => {
    for (const [, text] of kept) {
      const once = roundTrip(text)
      expect(roundTrip(once)).toBe(once)
    }
  })

  it('writes a table unpadded', () => {
    expect(roundTrip('| Name | What it holds |\n| :-- | ---: |\n| `a` | x \\| y |\n|  | z |')).toBe('| Name | What it holds |\n| :--- | ---: |\n| `a` | x \\| y |\n|  | z |\n')
  })

  it('keeps a table inside a list apart from the next item', () => {
    const text = '- tests:\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n- next item'
    expect(previewLoss(text)).toBeNull()
    expect(roundTrip(roundTrip(text))).toContain('- next item')
  })

  it.each([
    ['two paragraphs inside an item before the next one', '1. First\n2. Second\n\n   Paragraph one of the item.\n\n   Paragraph two of the item.\n3. Third'],
    ['three paragraphs inside the last item', '1. First\n\n   one\n\n   two\n\n   three'],
    ['a wider marker', '10. First\n\n    one\n\n    two'],
    ['a two-line paragraph after the first one', '1. First\n\n   para\n\n   tail one\n   tail two'],
  ])('keeps the indent of %s in an ordered list', (_, text) => {
    expect(previewLoss(text)).toBeNull()
    const once = roundTrip(text)
    expect(once.match(/^ +(?=\S)/gm)?.map((indent) => indent.length)).toEqual(text.match(/^ +(?=\S)/gm)?.map((indent) => indent.length))
    expect(roundTrip(once)).toBe(once)
  })

  it('lines an ordered item up to a single space after its marker', () => {
    expect(roundTrip('1.  First\n\n    one\n\n    two')).toBe('1. First\n\n   one\n\n   two')
  })

  it('keeps code and a quote inside an ordered item', () => {
    for (const text of ['1. First\n\n   para\n\n       code line', '1. First\n\n   para\n\n   ```\n   fenced\n   ```', '1. First\n\n   para\n\n   > quote']) {
      const once = roundTrip(text)
      expect(once, text).toContain(text.split('\n').at(-1)!.trim().replace(/^> /, ''))
      expect(roundTrip(once), text).toBe(once)
    }
  })

  it('leaves one empty line after a table at the top', () => {
    const text = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n1. first\n\nafter'
    expect(roundTrip(text)).toBe(text)
  })

  it('keeps empty lines after a table-like line inside code', () => {
    const text = '```\n| a |\n\n\nb\n```'
    expect(roundTrip(text)).toBe(text)
  })

  it('keeps a fenced block holding a fence intact', () => {
    expect(roundTrip('````md\n```js\ninner\n```\n````')).toBe('````md\n```js\ninner\n```\n````')
  })

  it('has nothing to lose in an empty text', () => {
    expect(previewLoss('')).toBeNull()
    expect(previewLoss('  \n')).toBeNull()
  })
})

describe('what the visual editor would drop keeps it to Markdown', () => {
  it.each([
    ['inline HTML', 'some <b>raw</b> text', 'html'],
    ['an HTML block', '<div align="center">\n\nlogo\n\n</div>', 'html'],
    ['a placeholder that reads as a tag', 'the branch btn-<number>', 'html'],
    ['a footnote', 'note[^1]\n\n[^1]: the foot', 'footnote'],
    ['a picture', 'look: ![screen](shot.png)', 'image'],
    ['an escaped heading mark', '\\# not a heading', 'other'],
  ] as const)('%s', (_, text, loss) => {
    expect(previewLoss(text)).toBe(loss)
  })
})

describe('real texts', () => {
  const samples = Object.entries(markdownFiles(import.meta.glob<string>('./descriptionSamples/**/*.md', { query: '?raw', import: 'default', eager: true })))
  it.each(samples)('task description %s goes through the visual editor whole', (_, text) => {
    expect(previewLoss(text)).toBeNull()
  })

  it('every document of docs/ is either kept or refused with a reason, never broken', () => {
    const files = Object.entries(
      markdownFiles({
        ...import.meta.glob<string>('../../../docs/**/*.md', { query: '?raw', import: 'default', eager: true }),
        ...import.meta.glob<string>(['../../../README.md', '../../../CHANGELOG.md'], { query: '?raw', import: 'default', eager: true }),
      }),
    )
    let kept = 0
    for (const [path, text] of files) {
      const loss = previewLoss(text)
      if (loss !== null) continue
      kept += 1
      const once = roundTrip(text)
      expect(roundTrip(once), path).toBe(once)
    }
    // Most of the documents are plain Markdown; a drop here means the editor stopped holding something it held.
    expect(kept / files.length).toBeGreaterThan(0.7)
  }, 60_000)
})
