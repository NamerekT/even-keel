import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

export function usePopover() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { open, setOpen, rootRef }
}

/**
 * The room a popover standing by its anchor's right edge has to grow left (BTN-1730): `--room` on the panel, from the
 * window's left gutter to the anchor's right edge, so a CSS width of `min(<width>, var(--room))` never leaves the window.
 */
export function usePopoverRoom<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const panel = ref.current
    const anchor = panel?.offsetParent
    if (panel == null || !(anchor instanceof HTMLElement)) return
    const fit = () => {
      const gutter = parseFloat(getComputedStyle(panel).getPropertyValue('--gutter')) || 0
      panel.style.setProperty('--room', `${Math.round(anchor.getBoundingClientRect().right - gutter)}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  return ref
}
