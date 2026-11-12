// A line that opens a Markdown code block: up to three spaces, then three or more backticks or tildes. A backtick
// fence's info string has no backtick in it (CommonMark).
const OPENING = /^ {0,3}(`{3,}(?!.*`)|~{3,})/

/** The fence of the code block left open at the end of `text`, `null` — none is open. */
function openFence(text: string): string | null {
  let open: string | null = null
  for (const line of text.split('\n')) {
    if (open === null) {
      open = OPENING.exec(line)?.[1] ?? null
      continue
    }
    const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1]
    if (close !== undefined && close[0] === open[0] && close.length >= open.length) open = null
  }
  return open
}

/**
 * `text` with the code block it ends inside closed by a fence of the same kind and length (BTN-1045), so that what
 * follows it reads as text; cut further when the fence would take it past `limit`. Unchanged when no block is open.
 */
export function closeFence(text: string, limit: number): string {
  const open = openFence(text)
  if (open === null) return text
  const closing = text.endsWith('\n') ? open : `\n${open}`
  if (text.length + closing.length <= limit) return text + closing
  return closeFence(text.slice(0, Math.max(0, limit - closing.length)), limit)
}
