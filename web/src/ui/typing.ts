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

export function typingTime(parts: string[], { charMs, pauseMs }: Pace): number {
  return parts.join('').length * charMs + Math.max(0, parts.length - 1) * pauseMs
}

/**
 * Books a line with the typist that frees first in `free` (the time each one is free from) and returns its start,
 * never earlier than `now`. As many typists as chains run at once, so the page types the way the dispatcher works.
 */
export function book(free: number[], now: number, duration: number): number {
  let slot = 0
  for (const [index, time] of free.entries()) if (time < free[slot]!) slot = index
  const start = Math.max(now, free[slot]!)
  free[slot] = start + duration
  return start
}
