import { withoutBlankColors } from './colors.js'

/** A ProseMirror node of Huly's markup. */
interface MarkupNode {
  type: string
  attrs?: Record<string, unknown>
  content?: MarkupNode[]
  text?: string
  marks?: unknown[]
}

export interface HulyImage {
  /** Where the picture stands in the Markdown. */
  ref: string
  /** The blob in the workspace storage. */
  blob: string
  name: string
}

export interface HulyText {
  markdown: string
  images: HulyImage[]
}

/** The `ref` a picture of blob `blob` gets in an imported text. */
export function imageRef(blob: string): string {
  return `huly-image:${blob}`
}

/**
 * A text of Huly as the import takes it (BTN-1079): a picture of the workspace storage stands as `imageRef` of its blob,
 * to be rewritten to its new attachment; a reference — a mention of a person, a link to an issue — is its label as plain
 * text, since Huly's `ref://` links lead nowhere outside Huly and an issue's label is its number; a colour mark without a
 * colour is dropped (`withoutBlankColors`).
 */
export function hulyText(json: unknown, toMarkdown: (json: unknown) => string): HulyText {
  const images: HulyImage[] = []
  const walk = (node: MarkupNode): MarkupNode[] => {
    if (node.type === 'reference') {
      const label = typeof node.attrs?.label === 'string' ? node.attrs.label : ''
      return label === '' ? [] : [{ type: 'text', text: label, ...(node.marks === undefined ? {} : { marks: node.marks }) }]
    }
    const blob = node.type === 'image' ? node.attrs?.['file-id'] : undefined
    if (typeof blob === 'string' && blob !== '') {
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
      if (!images.some((each) => each.blob === blob)) images.push({ ref: imageRef(blob), blob, name: alt || `image-${images.length + 1}` })
      // Without `file-id`, width or height Huly's serializer writes the plain `![alt](src)`.
      return [{ type: 'image', attrs: { src: imageRef(blob), alt } }]
    }
    return [node.content === undefined ? node : { ...node, content: node.content.flatMap(walk) }]
  }
  const [root] = walk(withoutBlankColors(json as MarkupNode))
  return { markdown: root === undefined ? '' : toMarkdown(root), images }
}
