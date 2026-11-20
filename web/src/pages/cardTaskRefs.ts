import type { Link, Parent, Root, Text } from 'mdast'

// Slash-delimited paths and the query or fragment of an address can contain a whole task number too.
const taskNumber = /(?<![\p{L}\p{M}\p{N}_/\\?#@=&-]|\w\.)([A-Z][A-Z0-9_]*)-\d+(?![\p{L}\p{M}\p{N}_/\\@-]|\.\w)/gu

export function taskRefParts(text: string, prefixes: ReadonlySet<string>): (Text | Link)[] {
  const parts: (Text | Link)[] = []
  let start = 0
  for (const match of text.matchAll(taskNumber)) {
    if (!prefixes.has(match[1]!)) continue
    const id = match[0]
    if (match.index > start) parts.push({ type: 'text', value: text.slice(start, match.index) })
    parts.push({ type: 'link', url: id, children: [{ type: 'text', value: id }] })
    start = match.index + id.length
  }
  if (start < text.length) parts.push({ type: 'text', value: text.slice(start) })
  return parts
}

export function remarkTaskRefs(prefixes: ReadonlySet<string>) {
  function visit(parent: Parent) {
    // Inline HTML tags are siblings of the Markdown between them until rehype-raw runs.
    let protectedDepth = 0
    parent.children = parent.children.flatMap((child) => {
      if (child.type === 'html') {
        if (/^<\/(a|code|pre)\s*>/i.test(child.value)) protectedDepth = Math.max(0, protectedDepth - 1)
        else if (/^<(a|code|pre)(?:\s[^<]*)?>$/i.test(child.value)) protectedDepth++
      } else if (!protectedDepth && child.type !== 'link' && child.type !== 'linkReference') {
        if (child.type === 'text') return taskRefParts(child.value, prefixes)
        if ('children' in child) visit(child)
      }
      return [child]
    })
  }
  return (tree: Root) => visit(tree)
}
