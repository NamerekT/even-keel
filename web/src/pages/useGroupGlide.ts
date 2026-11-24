import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { ChainBlock } from '../state.js'
import { stillMotion } from '../ui/landing.js'
import { moveDelay, regroups, STEP_MS, type Motion } from '../ui/motion.js'

const GLIDE = 'group-glide'
const CAPTION = '.chain__group-caption'

/**
 * The rows that move into the running group or out of it (BTN-1613), and the group's frame. A row glides from where it
 * stood to its new place (FLIP on `translate`, so a drag's `transform` stays its own), the rows it passes with it; a row
 * on its way out is held in the frame until it moves. The frame is drawn around its rows as they are on screen, so it
 * stretches to meet a row coming in, and glides shut once a row has gone.
 *
 * `play` is called from the motion's layout effect, before this hook's own one records the rows' new places: call the
 * hook after `useChainMotion`.
 */
export function useGroupGlide(
  listRef: RefObject<HTMLElement | null>,
  frameRef: RefObject<HTMLElement | null>,
  members: readonly string[],
  play: MutableRefObject<(motion: Motion<ChainBlock>) => void>,
): void {
  const tops = useRef(new Map<string, number>())
  const glides = useRef(new Map<string, Glide>())
  const rebasing = useRef(false)
  /** Rows kept in the frame until they move: those leaving and the one left alone, until when. */
  const holds = useRef(new Map<string, number>())
  const until = useRef(0)
  const glideUntil = useRef(0)
  const framed = useRef(0)
  /** Until when the caption shows: while the frame is shown and a step after, as it fades. */
  const captionUntil = useRef(0)
  const looping = useRef(false)
  const shown = useRef(members)
  shown.current = members

  const place = () => {
    const list = listRef.current
    const frame = frameRef.current
    if (list === null || frame === null) return
    const now = performance.now()
    for (const [id, at] of holds.current) if (at <= now) holds.current.delete(id)
    const ids = [...new Set([...shown.current, ...holds.current.keys()])]
    const rows = ids.flatMap((id) => {
      const row = rowOf(list, id)
      return row === null ? [] : [{ row, rect: row.getBoundingClientRect() }]
    })
    const rects = rows.map((each) => each.rect)
    // One row fewer in the frame: it glides shut rather than jumps.
    if (rects.length < framed.current) glideUntil.current = now + STEP_MS
    if (rects.length < 2 && framed.current > 1) track(now + STEP_MS)
    framed.current = rects.length
    if (rects.length > 1) captionUntil.current = now + STEP_MS
    frame.classList.toggle('chain__group--glide', now < glideUntil.current)
    frame.classList.toggle('chain__group--shown', rects.length > 1)
    // The edge's gap under the caption (BTN-1624): the caption does not wrap, so its width is the text's alone. The
    // row at the frame's top gets the gap in its own edge, which it holds for a step as it joins or parts, while the
    // caption shows or fades.
    const caption = frame.querySelector<HTMLElement>(CAPTION)
    if (caption !== null) list.style.setProperty('--caption-width', `${caption.getBoundingClientRect().width}px`)
    const topRow = now < captionUntil.current && rows.length > 0 ? rows.reduce((a, b) => (b.rect.top < a.rect.top ? b : a)).row : null
    for (const row of list.querySelectorAll<HTMLElement>('li[data-group-top]')) if (row !== topRow) delete row.dataset.groupTop
    if (topRow !== null) topRow.dataset.groupTop = ''
    if (rects.length === 0) return
    const base = list.getBoundingClientRect()
    const top = Math.min(...rects.map((rect) => rect.top))
    const left = Math.min(...rects.map((rect) => rect.left))
    frame.style.top = `${top - base.top}px`
    frame.style.left = `${left - base.left}px`
    frame.style.width = `${Math.max(...rects.map((rect) => rect.right)) - left}px`
    frame.style.height = `${Math.max(...rects.map((rect) => rect.bottom)) - top}px`
  }

  const track = (end: number) => {
    until.current = Math.max(until.current, end)
    if (looping.current) return
    looping.current = true
    const step = () => {
      place()
      if (performance.now() < until.current) requestAnimationFrame(step)
      else looping.current = false
    }
    requestAnimationFrame(step)
  }

  play.current = (motion) => {
    const list = listRef.current
    if (list === null || !regroups(motion) || stillMotion()) return
    const now = performance.now()
    let end = now
    for (const row of list.querySelectorAll<HTMLElement>('li[data-block]')) {
      const id = row.dataset.block!
      const before = tops.current.get(id)
      if (before === undefined) continue
      const shift = before + shiftOf(row) - row.offsetTop
      if (Math.abs(shift) < 1) continue
      for (const animation of row.getAnimations()) if (animation.id === GLIDE) animation.cancel()
      const delay = moveDelay(motion, id)
      // The row that changes its place in the group goes over the ones it passes.
      const zIndex = motion.joined.includes(id) || motion.parted.includes(id) ? 2 : 1
      const glide = row.animate(glideFrames(shift, zIndex), { duration: STEP_MS, delay, easing: 'ease-out', fill: 'backwards' })
      glide.id = GLIDE
      glides.current.set(id, { animation: glide, shift, zIndex, at: row.offsetTop })
      end = Math.max(end, now + delay + STEP_MS)
    }
    for (const id of [...motion.parted, ...motion.alone]) {
      const release = now + moveDelay(motion, id)
      holds.current.set(id, release)
      end = Math.max(end, release + STEP_MS)
    }
    track(end)
    // Only the renders before the next paint belong to this motion; a later move is the rows' own (a copy collapsing).
    rebasing.current = true
    requestAnimationFrame(() => {
      rebasing.current = false
    })
  }

  // After every render: the rows' places for the next motion, and the frame around its rows.
  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null) return
    if (rebasing.current) rebase(list, glides.current)
    record(list, tops.current)
    place()
  })

  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const observer = new ResizeObserver(() => {
      record(list, tops.current)
      place()
    })
    observer.observe(list)
    const caption = frameRef.current?.querySelector(CAPTION)
    if (caption) observer.observe(caption)
    return () => observer.disconnect()
    // The list and the frame live as long as the page.
  }, [listRef, frameRef])
}

interface Glide {
  animation: Animation
  shift: number
  zIndex: number
  /** The row's place in the layout the shift was measured against. */
  at: number
}

function glideFrames(shift: number, zIndex: number): Keyframe[] {
  return [
    { translate: `0 ${shift}px`, zIndex },
    { translate: '0 0', zIndex },
  ]
}

/**
 * A glide keeps starting where its row stood. The render after a motion's can move the rows again (the copy of a row
 * leaving for the closed ones comes in it), and a shift measured before that would start the row off its old place.
 */
function rebase(list: HTMLElement, glides: Map<string, Glide>): void {
  for (const [id, glide] of glides) {
    const row = rowOf(list, id)
    const state = glide.animation.playState
    if (row === null || state === 'finished' || state === 'idle') {
      glides.delete(id)
      continue
    }
    const moved = glide.at - row.offsetTop
    if (Math.abs(moved) < 1) continue
    glide.shift += moved
    glide.at = row.offsetTop
    ;(glide.animation.effect as KeyframeEffect).setKeyframes(glideFrames(glide.shift, glide.zIndex))
  }
}

function rowOf(list: HTMLElement, id: string): HTMLElement | null {
  return list.querySelector<HTMLElement>(`li[data-block="${CSS.escape(id)}"]`)
}

/** The rows' places in the list's layout, a glide's shift not counted. */
function record(list: HTMLElement, tops: Map<string, number>): void {
  tops.clear()
  for (const row of list.querySelectorAll<HTMLElement>('li[data-block]')) tops.set(row.dataset.block!, row.offsetTop)
}

/** Where a row gliding now stands against its place. */
function shiftOf(row: HTMLElement): number {
  if (!row.getAnimations().some((animation) => animation.id === GLIDE && animation.playState === 'running')) return 0
  const [, y = '0'] = getComputedStyle(row).translate.split(' ')
  return Number.parseFloat(y) || 0
}
