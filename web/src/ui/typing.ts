/** How fast a line is typed: per character, and the hold after each part but the last. */
export interface Pace {
  charMs: number
  pauseMs: number
}

/** How many characters of the joined parts are typed `elapsed` ms after the start. */
export function typedAt(parts: string[], elapsed: number, { charMs, pauseMs }: Pace): number {
  let shown = 0
  let left = elapsed
  for (const [index, part] of parts.entries()) {
    const typing = part.length * charMs
    if (left < typing) return shown + Math.floor(left / charMs)
    shown += part.length
    left -= typing
    if (index < parts.length - 1) {
      if (left < pauseMs) return shown
      left -= pauseMs
    }
  }
  return shown
}
