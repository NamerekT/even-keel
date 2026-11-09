import { BADGE_CHARS, BADGE_FONTS } from './fonts.generated.js'

export type BadgeFace = 'sans' | 'sans-bold' | 'mono'

const FACE_FONT: Record<BadgeFace, { family: 'sans' | 'mono'; weight: number }> = {
  sans: { family: 'sans', weight: 400 },
  'sans-bold': { family: 'sans', weight: 600 },
  mono: { family: 'mono', weight: 400 },
}

/** A character the fonts lack is drawn by a system font: counted wide, so a cut line still fits. */
const UNKNOWN_EM = 0.72
const ELLIPSIS = '…'

const tables = new Map<BadgeFace, Map<string, number>>()

function tableOf(face: BadgeFace): Map<string, number> {
  const known = tables.get(face)
  if (known !== undefined) return known
  const { family, weight } = FACE_FONT[face]
  const font = BADGE_FONTS.find((each) => each.family === family && each.weight === weight)!
  const table = new Map([...BADGE_CHARS].map((char, index) => [char, font.widths[index]! / font.unitsPerEm]))
  tables.set(face, table)
  return table
}

/** The width of `text` in pixels as the badge's embedded font draws it at `size`: the sum of advances, no kerning. */
export function measure(text: string, face: BadgeFace, size: number): number {
  const table = tableOf(face)
  let em = 0
  for (const char of text) em += table.get(char) ?? UNKNOWN_EM
  return em * size
}

/** `text` cut with an ellipsis so that it fits `width`; the whole text when it fits, an empty one when not even "…" does. */
export function fit(text: string, face: BadgeFace, size: number, width: number): string {
  if (measure(text, face, size) <= width) return text
  const chars = [...text]
  const room = width - measure(ELLIPSIS, face, size)
  if (room < 0) return ''
  let used = 0
  let count = 0
  const table = tableOf(face)
  for (const char of chars) {
    const next = used + (table.get(char) ?? UNKNOWN_EM) * size
    if (next > room) break
    used = next
    count++
  }
  return `${chars.slice(0, count).join('').trimEnd()}${ELLIPSIS}`
}

/** Text and attribute values safe inside SVG; control characters XML forbids are dropped. */
export function escapeXml(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
}
