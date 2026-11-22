/** What stands in the description while file `n` uploads; the number keeps two uploads of one name apart. */
export const uploadMark = (label: string, n: number): string => `![${escaped(label)}](#upload-${n})`

/** `piece` over the selection `from`…`to`; no caret (the visual editor was open) — a paragraph of its own at the end. */
export function inserted(text: string, from: number | null, to: number | null, piece: string): { text: string; end: number } {
  if (from === null) {
    const head = text.trimEnd()
    const next = head === '' ? piece : `${head}\n\n${piece}`
    return { text: next, end: next.length }
  }
  const next = text.slice(0, from) + piece + text.slice(to ?? from)
  return { text: next, end: from + piece.length }
}

/** The upload's mark replaced by what it came to; a mark the user already deleted leaves the text as it is. */
export const settled = (text: string, mark: string, final: string): string => text.replace(mark, () => final)

/** A picture shows in the card, any other file is a link to download. */
export const fileMarkdown = (name: string, type: string, url: string): string => `${PICTURE.test(type) ? '!' : ''}[${escaped(name)}](${url})`

/** The pictures the service shows in place (`sniffedType`); an SVG under a policy that runs none of its scripts. */
const PICTURE = /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/

const escaped = (text: string) => text.replace(/[[\]\\]/g, (char) => `\\${char}`)
