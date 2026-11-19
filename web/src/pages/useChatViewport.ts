import { useLayoutEffect, type RefObject } from 'react'

/** A mobile keyboard can pan and shrink the visible part of the page while the layout viewport stays full height. */
export function useChatViewport(ref: RefObject<HTMLDialogElement | null>, narrow: boolean) {
  useLayoutEffect(() => {
    const viewport = window.visualViewport
    const dialog = ref.current
    if (!narrow || !viewport || !dialog) return
    let covered = false
    const sync = () => {
      if (viewport.scale !== 1) {
        dialog.style.removeProperty('--chat-visible-height')
        dialog.style.removeProperty('--chat-visible-top')
        return
      }
      dialog.style.setProperty('--chat-visible-height', `${viewport.height}px`)
      dialog.style.setProperty('--chat-visible-top', `${viewport.offsetTop}px`)
      // Android's Back can dismiss the keyboard while leaving the field focused.
      if (dialog.querySelector('textarea:focus')) {
        if (window.innerHeight - viewport.height > 1) {
          covered = true
          delete dialog.dataset.keyboardClosed
        } else if (covered) {
          covered = false
          dialog.dataset.keyboardClosed = ''
        }
      }
    }
    const reset = () => {
      covered = false
      delete dialog.dataset.keyboardClosed
      sync()
    }
    sync()
    dialog.addEventListener('focusin', reset)
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      dialog.removeEventListener('focusin', reset)
      dialog.style.removeProperty('--chat-visible-height')
      dialog.style.removeProperty('--chat-visible-top')
      delete dialog.dataset.keyboardClosed
    }
  }, [ref, narrow])
}
