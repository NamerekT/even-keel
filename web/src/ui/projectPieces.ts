/** A part of a text: plain text, or a project the text names by its id. */
export type Piece = string | { project: string }

const escaped = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The text cut at every project id it names (BTN-319): a server message or a page text given ids says a project by its
 * id. An id inside a task id (`ABC-5`) or a longer word is not a project, so one stands between non-word characters.
 */
export function piecesOf(text: string, projects: readonly string[]): Piece[] {
  if (projects.length === 0) return [text]
  const ids = [...projects].sort((a, b) => b.length - a.length).map(escaped)
  const pattern = new RegExp(`(?<![\\w-])(?:${ids.join('|')})(?![\\w-])`, 'g')
  const pieces: Piece[] = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > at) pieces.push(text.slice(at, match.index))
    pieces.push({ project: match[0] })
    at = match.index + match[0].length
  }
  if (at < text.length) pieces.push(text.slice(at))
  return pieces
}
