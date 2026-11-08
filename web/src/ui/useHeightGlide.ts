import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Longer than any `--motion-*` a glide takes: past it the element gets its own height back even without `transitionend`. */
const GUARD_MS = 600

/**
 * Glides the element's height from the old content's to the new one's when `key` changes (a tab), instead of a jump.
 * The element needs a `transition` on `height` in its CSS; while it glides, a child with `overflow: auto` shrinks.
 * A height that stays (a full-screen dialog) and reduced motion change nothing, and neither does an effect run again
 * for the same key: StrictMode's second run comes after a dialog's `showModal` and would glide it up from 0.
 */
export function useHeightGlide(ref: RefObject<HTMLElement | null>, key: unknown): void {
  const last = useRef<number | null>(null)
  const gliding = useRef(false)
  const seen = useRef(key)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    const observer = new ResizeObserver(() => {
      if (!gliding.current) last.current = element.offsetHeight
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = ref.current
    const from = last.current
    if (seen.current === key) return
    seen.current = key
    if (element === null || from === null || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    element.style.height = ''
    const to = element.offsetHeight
    if (Math.abs(to - from) < 1) return
    gliding.current = true
    element.style.height = `${from}px`
    void element.offsetHeight
    element.style.height = `${to}px`
    // The height on screen when the glide ends: the content's own at the end, the one reached so far when the key
    // changes again mid-glide, so the next glide starts where this one stopped.
    const finish = (reached: number | null) => {
      clearTimeout(guard)
      element.removeEventListener('transitionend', onEnd)
      element.style.height = ''
      gliding.current = false
      last.current = reached ?? element.offsetHeight
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'height') finish(null)
    }
    const guard = setTimeout(() => finish(null), GUARD_MS)
    element.addEventListener('transitionend', onEnd)
    return () => {
      if (gliding.current) finish(element.offsetHeight)
    }
  }, [key])
}
