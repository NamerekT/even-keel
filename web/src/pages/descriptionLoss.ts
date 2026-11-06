import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

/** What the visual editor would drop from a description: raw HTML, footnotes, pictures, or something else. */
export type PreviewLoss = 'html' | 'footnote' | 'image' | 'other'

interface MdNode {
  type: string
  children?: MdNode[]
  [key: string]: unknown
}

const parser = unified().use(remarkParse).use(remarkGfm)

const KIND: Record<string, PreviewLoss> = {
  html: 'html',
  footnoteReference: 'footnote',
  footnoteDefinition: 'footnote',
  image: 'image',
  imageReference: 'image',
}

/**
 * The text's tree as it reads, not as it is typed: positions, list looseness and the choice of markers (`*` or `-`,
 * `_` or `*`) are not kept by the tree; references are resolved to the links they name; neighbouring text is joined.
 */
function meaning(markdown: string): MdNode {
  const tree = parser.parse(markdown) as unknown as MdNode
  const definitions = new Map<string, { url: unknown; title: unknown }>()
  const collect = (node: MdNode) => {
    if (node.type === 'definition') definitions.set(String(node.identifier), { url: node.url, title: node.title ?? null })
    node.children?.forEach(collect)
  }
  collect(tree)
  const clean = (node: MdNode): MdNode | null => {
    if (node.type === 'definition') return null
    const out: MdNode = { type: node.type }
    // Sorted, so the trees compare as JSON whatever order the parser set the keys in.
    for (const [key, value] of Object.entries(node).sort(([a], [b]) => a.localeCompare(b))) {
      if (key === 'position' || key === 'spread' || key === 'children' || key === 'type') continue
      out[key] = value
    }
    if (node.type === 'linkReference') {
      const target = definitions.get(String(node.identifier))
      if (target !== undefined) return clean({ type: 'link', url: target.url, title: target.title, children: node.children })
    }
    if (node.type === 'link' && out.title === undefined) out.title = null
    if (node.children !== undefined) {
      const children: MdNode[] = []
      for (const child of node.children) {
        const kept = clean(child)
        if (kept === null) continue
        const last = children.at(-1)
        if (kept.type === 'text' && last?.type === 'text') last.value = String(last.value) + String(kept.value)
        else children.push(kept)
      }
      out.children = children
    }
    return out
  }
  return clean(tree)!
}

function kindsIn(node: MdNode, found: Set<PreviewLoss>): Set<PreviewLoss> {
  const kind = KIND[node.type]
  if (kind !== undefined) found.add(kind)
  node.children?.forEach((child) => kindsIn(child, found))
  return found
}

/**
 * Whether `back`, what the editor writes for `markdown`, still says the same; if not, the first kind of thing the
 * editor does not hold that the text has, or `other`. `back` is `null` when the editor refused the text outright.
 */
export function previewLossOf(markdown: string, back: string | null): PreviewLoss | null {
  const before = meaning(markdown)
  if (back !== null && JSON.stringify(before) === JSON.stringify(meaning(back))) return null
  const kinds = kindsIn(before, new Set())
  for (const kind of ['html', 'footnote', 'image'] as const) if (kinds.has(kind)) return kind
  return 'other'
}
