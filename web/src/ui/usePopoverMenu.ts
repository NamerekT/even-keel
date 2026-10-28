import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

/**
 * A menu in a popover under its button: it opens placed by `place`, focuses its first live item, closes on a pointer or
 * a scroll outside its root, on a resize, on Tab and on Escape (back to the button), and moves between items by arrows.
 */
export function usePopoverMenu<Menu extends HTMLElement>(place: (menu: HTMLElement, at: DOMRect) => void) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<Menu>(null)

  useLayoutEffect(() => {
    const element = menu.current
    const owner = button.current
    if (!open || element === null || owner === null) return
    element.showPopover()
    place(element, owner.getBoundingClientRect())
    element.querySelector<HTMLButtonElement>('button:not([aria-disabled="true"])')?.focus({ preventScroll: true })
    const away = (event: Event) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false)
    }
    const shut = () => setOpen(false)
    document.addEventListener('pointerdown', away)
    document.addEventListener('scroll', away, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', shut)
      if (element.matches(':popover-open')) element.hidePopover()
    }
    // The menu is placed once per opening: `place` is a plain function of the caller, new on every render.
  }, [open])

  const onKeyDown = (event: KeyboardEvent<Menu>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      // A drawer around would take the same Escape as its own close.
      event.stopPropagation()
      setOpen(false)
      button.current?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      const at = items.findIndex((item) => item === document.activeElement)
      const next = at + (event.key === 'ArrowDown' ? 1 : -1)
      items[(next + items.length) % items.length]?.focus()
    }
  }

  return { open, setOpen, root, button, menu, onKeyDown }
}
