import { useEffect, useRef, useState, type RefObject } from 'react'

/** How far from its end, px, a feed still counts as at its end. */
const PINNED_SLACK = 24
/** How long after the reader's wheel, touch or key a scroll still counts as theirs, ms: smooth scrolling runs on after it. */
const INPUT_MS = 800
// Tab too: the browser scrolls a focused link or button of the feed into view.
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Tab'])

/**
 * What a scroll event of a feed means. It comes after the layout it was raised in: content that grew in between (late
 * layout of folds, images, the mail list) and a box that shrank back (the chat's foot laid out late, the browser clamping
 * the position) leave a pinned feed short of its end with no move of the reader's (BTN-1372). So a pinned feed lets go
 * only when the reader moved it, and not even then while it went no higher than it was put.
 * `end` — put it at its end again; `pinned` — at its end within the slack; `free` — the reader is elsewhere.
 */
export function afterScroll(pinned: boolean, reader: boolean, top: number, placed: number, gap: number): 'end' | 'pinned' | 'free' {
  if (pinned && (!reader || top >= placed - 1)) return gap < 1 ? 'pinned' : 'end'
  return gap < PINNED_SLACK ? 'pinned' : 'free'
}

/**
 * How far above its end, px, the reader must take a feed before the phone's chat field shrinks to its short draft: more
 * than the three lines the field gives back plus the slack, or the shrink itself would bring the end back and pin the feed.
 */
const RAISE_MARGIN = 120

/**
 * Whether the reader took the feed up from its end (BTN-1700): the phone's unfocused field with a draft then shows two
 * lines, not five. It rises only past the margin and comes down only when the feed is pinned again, so the field's own
 * change of height never flips it back.
 */
export function feedRaised(raised: boolean, pinned: boolean, gap: number): boolean {
  if (pinned) return false
  return raised || gap > RAISE_MARGIN
}

const editable =(target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/**
 * A feed that keeps to its end until the reader scrolls up: `pin` after a change, `handlers` on the scroll box. A press
 * on the box (its scrollbar too) counts as the reader's until it is let go. `raised` — see `feedRaised`.
 */
export function useFeedPin(ref: RefObject<HTMLElement | null>) {
  const pinned = useRef(true)
  const placed = useRef(0)
  const inputAt = useRef(Number.NEGATIVE_INFINITY)
  const pressed = useRef(false)
  const [raised, setRaised] = useState(false)
  const touched = () => {
    inputAt.current = performance.now()
  }
  const pin = () => {
    const list = ref.current
    if (list === null || !pinned.current) return
    list.scrollTop = list.scrollHeight
    placed.current = list.scrollTop
  }
  const onScroll = () => {
    const list = ref.current
    if (list === null) return
    const reader = pressed.current || performance.now() - inputAt.current < INPUT_MS
    const gap = list.scrollHeight - list.scrollTop - list.clientHeight
    const now = afterScroll(pinned.current, reader, list.scrollTop, placed.current, gap)
    pinned.current = now !== 'free'
    placed.current = list.scrollTop
    setRaised((was) => feedRaised(was, pinned.current, gap))
    if (now === 'end') pin()
  }

  // Keys scroll the box from anywhere in its window, a typed space or arrow does not.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key) && (event.key === 'Tab' || !editable(event.target))) touched()
    }
    const onRelease = () => {
      if (pressed.current) touched()
      pressed.current = false
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerup', onRelease, true)
    window.addEventListener('pointercancel', onRelease, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerup', onRelease, true)
      window.removeEventListener('pointercancel', onRelease, true)
    }
  }, [])

  const handlers = {
    onScroll,
    onWheel: touched,
    onTouchMove: touched,
    onPointerDown: () => {
      pressed.current = true
      touched()
    },
  }
  return { pinned, pin, handlers, raised }
}
