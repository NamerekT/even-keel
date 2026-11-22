interface MarkupNode {
  type?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: MarkupNode[]
}

const COLOR_MARKS = new Set(['textColor', 'textStyle'])

const blank = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '')

type Mark = NonNullable<MarkupNode['marks']>[number]

/** A mark as it stays: a colour mark loses its blank `color`, and with nothing left it is gone. */
function keptMark(mark: Mark): Mark[] {
  if (!COLOR_MARKS.has(mark.type) || mark.attrs === undefined || !('color' in mark.attrs) || !blank(mark.attrs.color)) return [mark]
  const { color: _color, ...rest } = mark.attrs
  return Object.values(rest).some((value) => !blank(value)) ? [{ ...mark, attrs: rest }] : []
}

/**
 * Huly's markup without a colour mark that names no colour (BTN-1450): Huly's editor leaves `textColor`/`textStyle` with
 * `color: null` behind, and its Markdown serializer writes it as `<span style="color: null">`. The text inside stays; a
 * mark with a real colour is kept. The tree is copied, not changed in place.
 */
export function withoutBlankColors<T>(json: T): T {
  const walk = (node: MarkupNode): MarkupNode => {
    const marks = node.marks?.flatMap(keptMark)
    const { marks: _marks, ...rest } = node
    return {
      ...rest,
      ...(marks === undefined || marks.length === 0 ? {} : { marks }),
      ...(node.content === undefined ? {} : { content: node.content.map(walk) }),
    }
  }
  return walk(json as MarkupNode) as T
}

/** The part of the Huly client's markup operations the public client does not expose (`@hcengineering/api-client` 0.7.423). */
interface MarkupInternals {
  refUrl: string
  imageUrl: string
}

export interface ColorModules {
  markupToJSON(markup: string): unknown
  markupToMarkdown(json: unknown, options?: { refUrl: string; imageUrl: string }): string
}

export type FetchMarkup = (cls: string, id: string, attribute: string, markup: string, format: 'markdown' | 'markup') => Promise<string>

interface FetchingClient {
  fetchMarkup: FetchMarkup
}

/**
 * `fetchMarkup` of a connected Huly client whose Markdown has no blank colour marks (`withoutBlankColors`): the
 * markup is fetched and converted here with the client's own link addresses, as the client would. A client without
 * those internals reads as it is, the marks left in, rather than fail the read.
 */
export function colorlessFetcher(client: FetchingClient, modules: ColorModules): FetchMarkup {
  return async (cls, id, attribute, markup, format) => {
    const internals = (client as { markup?: Partial<MarkupInternals> }).markup
    if (format !== 'markdown' || typeof internals?.refUrl !== 'string' || typeof internals.imageUrl !== 'string') {
      return client.fetchMarkup(cls, id, attribute, markup, format)
    }
    const raw = await client.fetchMarkup(cls, id, attribute, markup, 'markup')
    return modules.markupToMarkdown(withoutBlankColors(modules.markupToJSON(raw)), { refUrl: internals.refUrl, imageUrl: internals.imageUrl })
  }
}
