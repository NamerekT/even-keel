import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { LoaderPhase } from './loaderPhase.js'

/** What the open window of a `Select` or a `SuggestField` holds (BTN-1257). */
export type ListLook = 'closed' | 'loader' | 'options'

/**
 * The loader's phase the window shows while its values are read: the entrance at once as reading starts, before
 * `useLoader` has stepped, so the list never flashes for a frame; `null` once the loader has left.
 */
export function listLoaderOf(phase: LoaderPhase, busy: boolean): Exclude<LoaderPhase, 'done'> | null {
  if (phase !== 'done') return phase
  return busy ? 'in' : null
}

/**
 * Nothing until the field is pressed, however long the values are read; the loader while they are, even with some
 * already there; then the options, or no window when the read brought none.
 */
export function listLookOf(open: boolean, loader: LoaderPhase | null, options: number): ListLook {
  if (!open) return 'closed'
  if (loader !== null) return 'loader'
  return options > 0 ? 'options' : 'closed'
}

/** Longer than `--motion-appear`: past it the window gets its own size back even without `transitionend`. */
const GUARD_MS = 600
const GLIDING = 'select__list--glide'

interface Size {
  width: number
  height: number
}

const sizeOf = (element: HTMLElement): Size => ({ width: element.offsetWidth, height: element.offsetHeight })

/**
 * Glides the open window from the loader's size to the list's, wider or narrower, instead of a jump. `place` puts the
 * window at its new size before the glide starts. `keepWidth` leaves the reached width on (a list with a search keeps
 * the width it opened with, so it does not jump under the typing). Reduced motion only places it.
 */
export function useListGlide(popup: RefObject<HTMLElement | null>, look: ListLook, place: (element: HTMLElement) => void, keepWidth = false): void {
  const last = useRef<Size | null>(null)
  const seen = useRef(look)
  const stop = useRef<(() => void) | null>(null)

  useLayoutEffect(() => {
    const element = popup.current
    const before = seen.current
    seen.current = look
    if (element === null || look === 'closed') {
      stop.current?.()
      last.current = null
      return
    }
    if (stop.current !== null) return
    const from = before === 'loader' && look === 'options' ? last.current : null
    if (from === null || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (from !== null) place(element)
      last.current = sizeOf(element)
      return
    }
    element.style.width = ''
    element.style.height = ''
    place(element)
    const to = sizeOf(element)
    if (Math.abs(to.width - from.width) < 1 && Math.abs(to.height - from.height) < 1) {
      last.current = to
      return
    }
    element.classList.add(GLIDING)
    element.style.width = `${from.width}px`
    element.style.height = `${from.height}px`
    void element.offsetHeight
    element.style.width = `${to.width}px`
    element.style.height = `${to.height}px`
    const finish = () => {
      clearTimeout(guard)
      element.removeEventListener('transitionend', onEnd)
      element.classList.remove(GLIDING)
      element.style.height = ''
      if (!keepWidth) element.style.width = ''
      stop.current = null
      last.current = sizeOf(element)
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'height') finish()
    }
    const guard = setTimeout(finish, GUARD_MS)
    element.addEventListener('transitionend', onEnd)
    stop.current = finish
  })

  useEffect(() => () => stop.current?.(), [])
}
