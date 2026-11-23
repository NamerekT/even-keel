import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Longer than any `--motion-*` a glide takes: past it the element gets its own height back even without `transitionend`. */
const GUARD_MS = 600
/** How long after a switch the content's own changes glide too: long enough for a tab's first answer (BTN-1499). */
export const FOLLOW_MS = 2000

/**
 * Glides the element's height from the old content's to the new one's when `key` changes (a tab), instead of a jump.
 * The element needs a `transition` on `height` in its CSS; while it glides, a child with `overflow: auto` shrinks.
 * A height that stays (a full-screen dialog) and reduced motion change nothing, and neither does an effect run again
 * for the same key: StrictMode's second run comes after a dialog's `showModal` and would glide it up from 0.
 * For `FOLLOW_MS` after the switch a change of the content (rows that replace a tab's "Loading…") glides as well:
 * mid-glide it turns the glide toward the new height from where the element is, after it starts a new one. The glide
 * holds the element's own size, so the change is heard inside it; later changes (typing) are left to the content.
 * While it glides the element carries `data-gliding`, for its CSS to keep a scrollbar from flashing in the cut content.
 */
export function useHeightGlide(ref: RefObject<HTMLElement | null>, key: unknown): void {
  const last = useRef<number | null>(null)
  const gliding = useRef(false)
  const follow = useRef<(() => void) | null>(null)
  const seen = useRef(key)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const resizes = new ResizeObserver(() => {
      if (!gliding.current) last.current = element.offsetHeight
    })
    resizes.observe(element)
    // The glide's own writes are the element's style attribute; anything else is the content changing.
    const changes = new MutationObserver((records) => {
      if (records.some((record) => record.target !== element || record.type !== 'attributes')) follow.current?.()
    })
    changes.observe(element, { childList: true, subtree: true, characterData: true, attributes: true })
    return () => {
      resizes.disconnect()
      changes.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    const element = ref.current
    const from = last.current
    if (seen.current === key) return
    seen.current = key
    if (element === null || from === null || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let guard: ReturnType<typeof setTimeout> | undefined
    // The height on screen when the glide ends: the content's own at the end, the one reached so far when the key
    // changes again mid-glide, so the next glide starts where this one stopped.
    const finish = (reached: number | null) => {
      clearTimeout(guard)
      element.removeEventListener('transitionend', onEnd)
      element.style.height = ''
      delete element.dataset.gliding
      gliding.current = false
      last.current = reached ?? element.offsetHeight
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'height') finish(null)
    }
    // Glides from `start` to the content's own height; false when they already match. Going through no height of its
    // own drops a running transition, so a glide under way starts over from `start` rather than queueing.
    const glide = (start: number) => {
      element.style.height = ''
      const to = element.offsetHeight
      if (Math.abs(to - start) < 1) return false
      element.style.height = `${start}px`
      void element.offsetHeight
      element.style.height = `${to}px`
      element.dataset.gliding = ''
      gliding.current = true
      element.addEventListener('transitionend', onEnd)
      clearTimeout(guard)
      guard = setTimeout(() => finish(null), GUARD_MS)
      return true
    }
    glide(from)
    // Mid-glide the element stands where the glide got to; after it, the ResizeObserver has not yet seen the change.
    follow.current = () => {
      const now = gliding.current ? element.offsetHeight : last.current
      if (now !== null && !glide(now) && gliding.current) finish(null)
    }
    const stop = setTimeout(() => (follow.current = null), FOLLOW_MS)
    return () => {
      clearTimeout(stop)
      follow.current = null
      if (gliding.current) finish(element.offsetHeight)
    }
  }, [key])
}
