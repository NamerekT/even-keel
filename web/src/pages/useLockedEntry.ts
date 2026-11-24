import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { stillMotion } from '../ui/landing.js'
import { STEP_MS } from '../ui/motion.js'

/** How long the ghost takes to grow open (`.block--ghost` in backlog.css), with a frame to spare. */
const GROW_MS = 300

/**
 * The way of a locked blocker into the chain on the chain's own row (BTN-1642). `press` notes where its row stands as
 * "Into the chain" is pressed; once it lands, the row slides from there to its place over `--motion-step`. While its
 * button is pointed at, a ghost that opens above the row would push the button from under the cursor: the page scrolls
 * with it instead, so the row stays put.
 */
export function useLockedEntry(
  listRef: RefObject<HTMLElement | null>,
  pointed: string | null,
  landed: string | null,
): { aim: (id: string | null) => void; press: (id: string) => void } {
  const from = useRef(new Map<string, number>())
  /** Where the pointed row stood on the screen before its ghost came. */
  const aimed = useRef<{ id: string; top: number } | null>(null)

  useLayoutEffect(() => {
    if (landed === null) return
    const top = from.current.get(landed)
    from.current.delete(landed)
    const row = rowOf(listRef.current, landed)
    if (top === undefined || row === null || stillMotion()) return
    const shift = top - offsetOf(listRef.current!, row)
    if (Math.abs(shift) < 1) return
    row.animate([{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration: STEP_MS, easing: 'ease' })
  }, [landed, listRef])

  useEffect(() => {
    if (pointed === null) return
    const row = rowOf(listRef.current, pointed)
    if (row === null) return
    const start = aimed.current?.id === pointed ? aimed.current.top : row.getBoundingClientRect().top
    const until = performance.now() + GROW_MS
    let frame = requestAnimationFrame(function hold() {
      const shift = row.getBoundingClientRect().top - start
      if (Math.abs(shift) >= 1) window.scrollBy(0, shift)
      if (performance.now() < until) frame = requestAnimationFrame(hold)
    })
    return () => cancelAnimationFrame(frame)
  }, [pointed, listRef])

  return {
    aim: (id) => {
      const row = id === null ? null : rowOf(listRef.current, id)
      aimed.current = id === null || row === null ? null : { id, top: row.getBoundingClientRect().top }
    },
    press: (id) => {
      const list = listRef.current
      const row = rowOf(list, id)
      if (list !== null && row !== null) from.current.set(id, offsetOf(list, row))
    },
  }
}

function rowOf(list: HTMLElement | null, id: string): HTMLElement | null {
  return list?.querySelector<HTMLElement>(`li[data-block="${CSS.escape(id)}"]:not(.block--ghost)`) ?? null
}

/** The row's top in the list, so a scroll between the press and the landing does not count as a move. */
function offsetOf(list: HTMLElement, row: HTMLElement): number {
  return row.getBoundingClientRect().top - list.getBoundingClientRect().top
}
