/** A row of a list as the bracket sees it: its layout box inside the list, and whether it is a blocker of the row after its run. */
export interface BracketRow {
  left: number
  top: number
  height: number
  blocker: boolean
}

/** The radius of the corner at the topmost blocker of a run. */
const RADIUS = 6

/**
 * The SVG path of the blockers' brackets of a list (BTN-1714), one line per run of blocker rows: from the topmost
 * blocker's middle with a rounded corner down to the top edge of the row the run stands before, straight ticks to the
 * other blockers of the run, no arrow. The line stands halfway in the blockers' indent, never left of the leftmost row;
 * a run with no row after it gets none. Coordinates are the list's, at pixel centres so a 1 px stroke stays sharp.
 */
export function bracketPath(rows: readonly BracketRow[], radius = RADIUS): string {
  if (rows.length === 0) return ''
  const leftmost = Math.min(...rows.map((row) => row.left))
  const middle = (row: BracketRow) => Math.round(row.top + row.height / 2) + 0.5
  const parts: string[] = []
  for (let index = 0; index < rows.length; index++) {
    if (!rows[index]!.blocker || rows[index - 1]?.blocker === true) continue
    let end = index
    while (rows[end]?.blocker === true) end++
    const held = rows[end]
    if (held === undefined) break
    const run = rows.slice(index, end)
    const tick = run[0]!.left
    const x = Math.max(Math.round((held.left + tick) / 2), leftmost) + 0.5
    const top = middle(run[0]!)
    parts.push(`M${tick} ${top} H${x + radius} Q${x} ${top} ${x} ${top + radius} V${held.top}`)
    for (const row of run.slice(1)) parts.push(`M${x} ${middle(row)} H${row.left}`)
    index = end
  }
  return parts.join(' ')
}
