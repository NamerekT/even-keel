import { getSchema, type AnyExtension, type JSONContent } from '@tiptap/core'
import Code from '@tiptap/extension-code'
import CodeBlock from '@tiptap/extension-code-block'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { renderTableToMarkdown, Table, TableKit } from '@tiptap/extension-table'
import { MarkdownManager } from '@tiptap/markdown'
import { DOMParser as SchemaParser } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { previewLossOf, type PreviewLoss } from './descriptionLoss.js'

/** A fence one backtick longer than any run inside the code, so a block holding ``` survives (CommonMark, 4.5). */
export function fenceFor(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((run) => run[0].length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * A table as `| a | b |`, not padded to its widest cell: an agent reads the description, and padding a long column costs
 * it hundreds of spaces a row. The rows come from `renderTableToMarkdown`, which escapes a pipe inside a cell.
 */
export function compactTable(markdown: string): string {
  // The empty line after the table stays: without it a list item that follows reads as one more row.
  return markdown
    .replace(/^\n+/, '')
    .split('\n')
    .map((line) => {
      if (!line.startsWith('| ') || !line.endsWith(' |')) return line
      const cells = line
        .slice(2, -2)
        .split(' | ')
        .map((cell) => cell.trim().replace(/^(:?)-{3,}(:?)$/, '$1---$2'))
      return `| ${cells.join(' | ')} |`
    })
    .join('\n')
}

/**
 * What the visual editor holds. Inline code may sit inside bold or a link (`**see `x`**`), which the stock mark excludes;
 * underline has no Markdown and is left out.
 */
export function descriptionExtensions(extra: AnyExtension[] = []): AnyExtension[] {
  return [
    StarterKit.configure({ code: false, codeBlock: false, underline: false, link: { openOnClick: false, autolink: true, linkOnPaste: true } }),
    Code.extend({ excludes: '' }),
    CodeBlock.extend({
      renderMarkdown: (node: JSONContent, helpers: { renderChildren: (content: JSONContent[]) => string }) => {
        const body = node.content === undefined ? '' : helpers.renderChildren(node.content)
        const fence = fenceFor(body)
        return `${fence}${(node.attrs?.language as string | null | undefined) ?? ''}\n${body}\n${fence}`
      },
    }),
    TableKit.configure({ table: false }),
    Table.extend({
      renderMarkdown: (node: JSONContent, helpers: Parameters<typeof renderTableToMarkdown>[1]) => compactTable(renderTableToMarkdown(node, helpers)),
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...extra,
  ]
}

let shared: { manager: MarkdownManager; schema: ReturnType<typeof getSchema> } | null = null

function tools() {
  if (shared === null) {
    const extensions = descriptionExtensions()
    shared = { manager: new MarkdownManager({ extensions }), schema: getSchema(extensions) }
  }
  return shared
}

/**
 * A continuation line's indent is no part of the paragraph (CommonMark, 4.8), but the parser keeps it in the text, and the
 * editor would show it and write it back changed.
 */
function dropIndents(node: JSONContent): JSONContent {
  if (node.type === 'codeBlock') return node
  if (node.type === 'text' && node.text !== undefined && !node.marks?.some((mark) => mark.type === 'code')) {
    return { ...node, text: node.text.replace(/\n[ \t]+/g, '\n') }
  }
  return node.content === undefined ? node : { ...node, content: node.content.map(dropIndents) }
}

/** The editor's document for a Markdown text. */
export function toDoc(markdown: string): JSONContent {
  return dropIndents(tools().manager.parse(markdown))
}

/**
 * A table's own trailing line (see `compactTable`) plus the gap between blocks leaves two empty lines after a table at the
 * top; one is dropped, outside fenced code, so a save does not add a line each time.
 */
function dropTableGaps(markdown: string): string {
  const lines = markdown.split('\n')
  const kept: string[] = []
  let fence: string | null = null
  for (const line of lines) {
    const mark = /^(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence === null && mark !== undefined) fence = mark
    else if (fence !== null && mark !== undefined && mark[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) fence = null
    const gap = fence === null && line === '' && kept.at(-1) === '' && /^\|.*\|$/.test(kept.at(-2) ?? '')
    if (!gap) kept.push(line)
  }
  return kept.join('\n')
}

/** The Markdown for the editor's document. */
export function toMarkdown(doc: JSONContent): string {
  return dropTableGaps(tools().manager.serialize(doc))
}

/** What the visual editor writes: without the empty lines at the end its trailing paragraph leaves after a table or code. */
export function editorMarkdown(doc: JSONContent): string {
  return toMarkdown(doc).replace(/\n+$/, '')
}

/** The Markdown the visual editor would write back for this text, through the editor's own schema. Throws on what it refuses. */
export function roundTrip(markdown: string): string {
  const node = tools().schema.nodeFromJSON(toDoc(markdown))
  node.check()
  return toMarkdown(node.toJSON() as JSONContent)
}

/** Clipboard HTML as Markdown, read through the editor's schema: what it has no node for (a picture, styling) drops out. */
export function htmlToMarkdown(html: string): string {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  const node = SchemaParser.fromSchema(tools().schema).parse(body)
  return toMarkdown(dropIndents(node.toJSON() as JSONContent)).trim()
}

/** Why the visual editor cannot take this text without losing a part of it; `null` when it can. */
export function previewLoss(markdown: string): PreviewLoss | null {
  if (markdown.trim() === '') return null
  let back: string
  let again: string
  try {
    back = roundTrip(markdown)
    again = roundTrip(back)
  } catch {
    return previewLossOf(markdown, null)
  }
  // What the editor writes must read the same once more, or the next opening would lose what this one kept.
  return previewLossOf(markdown, back) ?? (previewLossOf(back, again) === null ? null : previewLossOf(markdown, null))
}

export type { PreviewLoss }
