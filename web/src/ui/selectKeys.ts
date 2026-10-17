/**
 * The indexes of the labels a search keeps: each holds every word of the query, in any case and order.
 * A label that starts with a word comes first, then one with a word of its own starting so, then the rest:
 * "fi" over "plugin · claude-plugins-official" lists figma before every plugin of that marketplace.
 */
export function filterOf(labels: readonly string[], query: string): number[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const scored = labels.flatMap((label, index) => {
    const text = label.toLocaleLowerCase()
    let score = 0
    for (const word of words) {
      const at = text.indexOf(word)
      if (at < 0) return []
      if (at === 0) continue
      score += boundary(text, word) ? 1 : 2
    }
    return [{ index, score }]
  })
  return scored.sort((a, b) => a.score - b.score).map((each) => each.index)
}

function boundary(text: string, word: string): boolean {
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1]!)) return true
  }
  return false
}

/** Where an arrow, Home or End moves the active option of a list of `count`; `undefined` for any other key. */
export function stepOf(key: string, active: number, count: number): number | undefined {
  const last = count - 1
  if (key === 'Home') return 0
  if (key === 'End') return last
  if (key === 'ArrowDown') return active < 0 ? 0 : Math.min(active + 1, last)
  if (key === 'ArrowUp') return active < 0 ? last : Math.max(active - 1, 0)
  return undefined
}

/**
 * The option typing picks: the first label, from the active one on and round, that starts with the typed text.
 * One letter typed again and again steps through the labels that start with it.
 */
export function matchOf(labels: readonly string[], typed: string, active: number): number {
  const text = typed.toLocaleLowerCase()
  const repeated = [...text].every((char) => char === text[0])
  const prefix = repeated ? text[0]! : text
  const from = repeated ? active + 1 : active
  for (let step = 0; step < labels.length; step++) {
    const index = (((from + step) % labels.length) + labels.length) % labels.length
    if (labels[index]!.toLocaleLowerCase().startsWith(prefix)) return index
  }
  return -1
}
