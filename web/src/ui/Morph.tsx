import { useLayoutEffect, useRef, type ReactNode } from 'react'
import './morph.css'

/**
 * Content that changes in place without a jump (BTN-1162): when `id` changes, the box slides from its old width to the
 * new one and the new content fades in. A button whose word changes, a status line. `className` goes on the content.
 */
export function Morph({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null)
  const width = useRef<number | null>(null)
  const first = useRef<string | null>(id)

  useLayoutEffect(() => {
    const element = box.current
    if (element === null) return
    // Mid-slide the box still has its inline width: the next slide starts from where this one is.
    const from = element.style.width === '' ? width.current : element.getBoundingClientRect().width
    element.style.width = ''
    const to = element.getBoundingClientRect().width
    width.current = to
    if (from === null || Math.abs(from - to) < 0.5 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    element.style.width = `${from}px`
    void element.offsetWidth
    element.style.width = `${to}px`
    const done = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === 'width') element.style.width = ''
    }
    element.addEventListener('transitionend', done)
    return () => element.removeEventListener('transitionend', done)
  }, [id])

  // Any other change of size (a font, the language) is the box's new width to slide from.
  useLayoutEffect(() => {
    const element = box.current
    if (element !== null && element.style.width === '') width.current = element.getBoundingClientRect().width
  })

  // The content of the first render shows as it is; every later one, keyed anew, fades in once from its mount.
  if (id !== first.current) first.current = null
  const face = className === undefined ? 'morph__face' : `morph__face ${className}`
  return (
    <span ref={box} className="morph">
      <span key={id} className={first.current === null ? `${face} morph__face--new` : face}>
        {children}
      </span>
    </span>
  )
}
