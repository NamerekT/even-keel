/**
 * Jira Cloud's REST v3 keeps descriptions and comments in the Atlassian Document Format, a JSON tree; Even Keel's
 * tracker layer speaks Markdown. The two converters cover what the chain writes and reads: headings, lists, code,
 * quotes, marks, links, mentions and media. A node they do not know is read by its content and never written.
 */
export interface AdfMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface AdfNode {
  type: string
  version?: number
  text?: string
  attrs?: Record<string, unknown>
  marks?: AdfMark[]
  content?: AdfNode[]
}

/** How a media node of the text is linked: `null` — the file is not known, it stays a mark. */
export type MediaLink = (media: { id: string; alt: string }) => { url: string; image: boolean } | null

export function adfToMarkdown(node: AdfNode | null | undefined, media: MediaLink = () => null): string {
  if (node == null) return ''
  return blocks(node.content ?? [], media).join('\n\n').trim()
}

function blocks(nodes: AdfNode[], media: MediaLink): string[] {
  return nodes.map((node) => block(node, media)).filter((text) => text !== '')
}

function block(node: AdfNode, media: MediaLink): string {
  const content = node.content ?? []
  switch (node.type) {
    case 'paragraph':
      return inline(content, media)
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 1)))} ${inline(content, media)}`
    case 'bulletList':
      return content.map((item) => listItem(item, '- ', media)).join('\n')
    case 'orderedList': {
      const start = Number(node.attrs?.order) || 1
      return content.map((item, index) => listItem(item, `${start + index}. `, media)).join('\n')
    }
    case 'taskList':
      return content.map((item) => listItem(item, item.attrs?.state === 'DONE' ? '- [x] ' : '- [ ] ', media)).join('\n')
    case 'codeBlock': {
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      return `\`\`\`${language}\n${content.map((each) => each.text ?? '').join('')}\n\`\`\``
    }
    case 'blockquote':
    case 'panel':
      return quote(blocks(content, media).join('\n\n'))
    case 'rule':
      return '---'
    case 'mediaSingle':
    case 'mediaGroup':
      return content.map((each) => mediaText(each, media)).join('\n\n')
    case 'media':
      return mediaText(node, media)
    case 'table':
      return table(content, media)
    case 'expand':
    case 'nestedExpand': {
      const title = typeof node.attrs?.title === 'string' && node.attrs.title !== '' ? `**${node.attrs.title}**` : ''
      return [title, ...blocks(content, media)].filter((text) => text !== '').join('\n\n')
    }
    default:
      return content.length === 0 ? inline([node], media) : blocks(content, media).join('\n\n')
  }
}

function listItem(item: AdfNode, marker: string, media: MediaLink): string {
  const content = item.content ?? []
  // A task item holds its text inline, a list item holds blocks.
  const body = item.type === 'taskItem' ? inline(content, media) : blocks(content, media).join('\n')
  const pad = ' '.repeat(/^\d/.test(marker) ? marker.length : 2)
  return marker + body.split('\n').join(`\n${pad}`)
}

function quote(text: string): string {
  return text.split('\n').map((line) => (line === '' ? '>' : `> ${line}`)).join('\n')
}

function mediaText(node: AdfNode, media: MediaLink): string {
  const alt = typeof node.attrs?.alt === 'string' && node.attrs.alt !== '' ? node.attrs.alt : 'file'
  const link = media({ id: String(node.attrs?.id ?? ''), alt })
  if (link === null) return `(attachment: ${alt})`
  return `${link.image ? '!' : ''}[${alt}](${link.url})`
}

function table(rows: AdfNode[], media: MediaLink): string {
  const cells = rows.map((row) => (row.content ?? []).map((cell) => blocks(cell.content ?? [], media).join(' ').replaceAll('\n', ' ').replaceAll('|', '\\|')))
  if (cells.length === 0) return ''
  const width = Math.max(...cells.map((row) => row.length))
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] ?? '').join(' | ')} |`
  return [line(cells[0]!), `| ${Array(width).fill('---').join(' | ')} |`, ...cells.slice(1).map(line)].join('\n')
}

function inline(nodes: AdfNode[], media: MediaLink): string {
  return nodes.map((node) => inlineNode(node, media)).join('')
}

function inlineNode(node: AdfNode, media: MediaLink): string {
  const attrs = node.attrs ?? {}
  switch (node.type) {
    case 'text':
      return marked(node.text ?? '', node.marks ?? [])
    case 'hardBreak':
      return '\\\n'
    case 'mention':
      return typeof attrs.text === 'string' && attrs.text !== '' ? attrs.text : `@${String(attrs.id ?? '')}`
    case 'emoji':
      return String(attrs.text ?? attrs.shortName ?? '')
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard':
      return typeof attrs.url === 'string' ? `<${attrs.url}>` : ''
    case 'status':
      return `[${String(attrs.text ?? '')}]`
    case 'date': {
      const at = Number(attrs.timestamp)
      return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : ''
    }
    case 'mediaInline':
      return mediaText(node, media)
    default:
      return inline(node.content ?? [], media)
  }
}

function marked(text: string, marks: AdfMark[]): string {
  const has = (type: string) => marks.find((mark) => mark.type === type)
  let result = has('code') ? `\`${text}\`` : escapeText(text)
  if (has('em')) result = `*${result}*`
  if (has('strong')) result = `**${result}**`
  if (has('strike')) result = `~~${result}~~`
  const link = has('link')
  if (link !== undefined && typeof link.attrs?.href === 'string') result = `[${result}](${link.attrs.href})`
  return result
}

function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]<>&~#!]/g, '\\$&')
    .replace(/^([ \t]*)([-+=])/gm, '$1\\$2')
    .replace(/^([ \t]*\d{1,9})([.)])(?=\s|$)/gm, '$1\\$2')
}

export function markdownToAdf(markdown: string): AdfNode {
  return { type: 'doc', version: 1, content: parseBlocks(markdown.replace(/\r\n?/g, '\n').split('\n')) }
}

const FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

function parseBlocks(lines: string[]): AdfNode[] {
  const nodes: AdfNode[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at]!
    if (line.trim() === '') {
      at++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const close = lines.findIndex((each, index) => index > at && each.trim().startsWith(fence[1]!))
      const end = close < 0 ? lines.length : close
      const code = lines.slice(at + 1, end).join('\n')
      nodes.push({ type: 'codeBlock', ...(fence[2] ? { attrs: { language: fence[2] } } : {}), content: code === '' ? [] : [{ type: 'text', text: code }] })
      at = end + 1
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      nodes.push({ type: 'heading', attrs: { level: heading[1]!.length }, content: parseInline(heading[2]!) })
      at++
      continue
    }
    if (RULE.test(line)) {
      nodes.push({ type: 'rule' })
      at++
      continue
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (at < lines.length && QUOTE.test(lines[at]!)) quoted.push(QUOTE.exec(lines[at++]!)![1]!)
      nodes.push({ type: 'blockquote', content: parseBlocks(quoted) })
      continue
    }
    if (ITEM.test(line)) {
      at = parseList(lines, at, nodes)
      continue
    }
    const paragraph: string[] = []
    while (at < lines.length && lines[at]!.trim() !== '' && !startsBlock(lines[at]!)) paragraph.push(lines[at++]!.trim())
    nodes.push({ type: 'paragraph', content: paragraphInline(paragraph) })
  }
  return nodes
}

const startsBlock = (line: string) => FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line)

/** The lines of a paragraph are joined by hard breaks: Even Keel's texts break lines where they mean it. */
function paragraphInline(lines: string[]): AdfNode[] {
  return lines.flatMap((line, index) => [...(index === 0 ? [] : [{ type: 'hardBreak' }]), ...parseInline(line.replace(/\\$/, ''))])
}

/** One list from `at`, of the marker kind and indent of its first item; returns the index after it. */
function parseList(lines: string[], at: number, out: AdfNode[]): number {
  const first = ITEM.exec(lines[at]!)!
  const indent = first[1]!.length
  const ordered = /\d/.test(first[2]!)
  const items: AdfNode[] = []
  while (at < lines.length) {
    const match = ITEM.exec(lines[at]!)
    if (match === null || match[1]!.length !== indent || /\d/.test(match[2]!) !== ordered) break
    const inner = [match[3]!]
    at++
    // Lines indented deeper than the marker belong to the item: its text and its nested lists.
    while (at < lines.length && lines[at]!.trim() !== '' && lines[at]!.length - lines[at]!.trimStart().length > indent) inner.push(lines[at++]!)
    items.push({ type: 'listItem', content: parseBlocks(dedent(inner)) })
  }
  out.push(ordered ? { type: 'orderedList', attrs: { order: Number.parseInt(first[2]!, 10) || 1 }, content: items } : { type: 'bulletList', content: items })
  return at
}

function dedent(lines: string[]): string[] {
  const depth = Math.min(...lines.slice(1).filter((line) => line.trim() !== '').map((line) => line.length - line.trimStart().length))
  return Number.isFinite(depth) ? [lines[0]!, ...lines.slice(1).map((line) => line.slice(depth))] : lines
}

const INLINE = /\\([!-/:-@[-`{-~])|`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*((?:\\.|[^*\\\s])(?:\\.|[^*\\])*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[((?:\\.|[^\]\\])+)\]\((\S+?)\)|<(https?:\/\/[^\s>]+)>|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

function parseInline(text: string, marks: AdfMark[] = []): AdfNode[] {
  const nodes: AdfNode[] = []
  const push = (value: string, extra: AdfMark[] = []) => {
    if (value === '') return
    const all = [...marks, ...extra]
    const last = nodes.at(-1)
    if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(all)) last.text += value
    else nodes.push(all.length === 0 ? { type: 'text', text: value } : { type: 'text', text: value, marks: all })
  }
  const nested = (value: string, mark: AdfMark) => {
    for (const node of parseInline(value, [...marks, mark])) {
      const last = nodes.at(-1)
      if (node.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])) last.text = (last.text ?? '') + (node.text ?? '')
      else nodes.push(node)
    }
  }
  let from = 0
  for (const match of text.matchAll(INLINE)) {
    push(text.slice(from, match.index))
    from = match.index + match[0].length
    const [, escaped, code, strong, strong2, strike, em, em2, label, href, angle, bare] = match
    if (escaped !== undefined) push(escaped)
    else if (code !== undefined) push(code, [{ type: 'code' }])
    else if (strong !== undefined || strong2 !== undefined) nested((strong ?? strong2)!, { type: 'strong' })
    else if (strike !== undefined) nested(strike, { type: 'strike' })
    else if (em !== undefined || em2 !== undefined) nested((em ?? em2)!, { type: 'em' })
    else if (label !== undefined) nested(label, { type: 'link', attrs: { href } })
    else {
      const url = (angle ?? bare)!
      push(url, [{ type: 'link', attrs: { href: url } }])
    }
  }
  push(text.slice(from))
  return nodes
}
