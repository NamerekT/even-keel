import { useRef, type RefObject } from 'react'

export interface BackdropEvent {
  target: EventTarget | null
  button: number
  preventDefault(): void
}

/**
 * Closes a modal from its backdrop only when the left button went both down and up on it. A `click` would not do: the
 * browser sends it to the common ancestor of the press and the release, which is the `<dialog>` itself when a text
 * selection is dragged out of the window. A press on the backdrop also does not start a selection.
 */
export function backdropHandlers(pressed: { current: boolean }, isBackdrop: (target: EventTarget | null) => boolean, close: () => void) {
  return {
    onPointerDown: (event: BackdropEvent) => {
      pressed.current = event.button === 0 && isBackdrop(event.target)
    },
    onMouseDown: (event: BackdropEvent) => {
      if (isBackdrop(event.target)) event.preventDefault()
    },
    onPointerUp: (event: BackdropEvent) => {
      const started = pressed.current
      pressed.current = false
      if (started && event.button === 0 && isBackdrop(event.target)) close()
    },
  }
}

/** The handlers of `backdropHandlers` for a `<dialog>`: its own box is the backdrop, `also` adds more of it. */
export function useBackdropClose(dialog: RefObject<HTMLElement | null>, close: () => void, also?: (target: Element) => boolean) {
  const pressed = useRef(false)
  const isBackdrop = (target: EventTarget | null) =>
    target !== null && (target === dialog.current || (also !== undefined && target instanceof Element && also(target)))
  return backdropHandlers(pressed, isBackdrop, close)
}
