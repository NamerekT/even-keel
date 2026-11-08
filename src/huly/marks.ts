/** Huly's Markdown converters, as `@hcengineering/text-markdown` gives them. */
export interface HulyMarkdown {
  markdownToMarkup(markdown: string): unknown
  markupToMarkdown(markup: unknown): string
}

/** The text to write and what was changed in it: `count` text nodes, `moved` the marks code left, `linked` inside a link. */
export interface FixedMarks {
  text: string
  count: number
  moved: string[]
  linked: boolean
}

interface MarkupNode {
  type: string
  marks?: { type: string }[]
  content?: MarkupNode[]
}

const WORDS: Record<string, string> = { bold: 'bold', italic: 'italics', strike: 'strikethrough' }

/**
 * Huly's editor lets a code mark stand alone only: inline code inside bold, italics, strikethrough or a link fails the
 * whole document (`RangeError: Invalid collection of marks`), and the text can no longer be edited (BTN-894). Each such
 * text node of Huly's markup loses one mark: the code mark inside a link, so the link stays one, every other mark
 * otherwise, so the code stays code. A text with nothing to fix comes back as given; a fixed one as Huly's Markdown of
 * the fixed markup, with its leading and trailing blank space kept.
 */
export function fixCodeMarks(text: string, markdown: HulyMarkdown): FixedMarks {
  if (text.trim() === '') return { text, count: 0, moved: [], linked: false }
  const markup = markdown.markdownToMarkup(text) as MarkupNode
  let count = 0
  let linked = false
  const moved = new Set<string>()
  const walk = (node: MarkupNode) => {
    const marks = node.marks ?? []
    if (marks.length > 1 && marks.some((mark) => mark.type === 'code')) {
      count++
      if (marks.some((mark) => mark.type === 'link')) {
        linked = true
        node.marks = marks.filter((mark) => mark.type !== 'code')
      } else {
        for (const mark of marks) if (mark.type !== 'code') moved.add(WORDS[mark.type] ?? mark.type)
        node.marks = marks.filter((mark) => mark.type === 'code')
      }
    }
    node.content?.forEach(walk)
  }
  walk(markup)
  if (count === 0) return { text, count, moved: [], linked }
  const lead = /^\s*/.exec(text)![0]
  const tail = /\s*$/.exec(text)![0]
  return { text: lead + markdown.markupToMarkdown(markup).trim() + tail, count, moved: [...moved], linked }
}

/** The line for the agent's answer over the fixes of one write (`fixed 1 mark: code moved out of bold`); `null` — none. */
export function marksNote(fixes: readonly FixedMarks[]): string | null {
  const count = fixes.reduce((sum, each) => sum + each.count, 0)
  if (count === 0) return null
  const moved = [...new Set(fixes.flatMap((each) => each.moved))]
  const what = [...(moved.length > 0 ? [`code moved out of ${moved.join(', ')}`] : []), ...(fixes.some((each) => each.linked) ? ['code mark removed inside a link'] : [])]
  return `fixed ${count} mark${count === 1 ? '' : 's'}: ${what.join('; ')}`
}
