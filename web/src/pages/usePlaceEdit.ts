import { useRef, useState, type KeyboardEvent } from 'react'
import { useLeaving } from './useLeaving.js'

export interface PlaceEdit {
  /** The text in the field; `null` — the field is shut and the value shows as text. */
  draft: string | null
  /** Opens the field with `text`, or shuts it with `null`. */
  show: (text: string | null) => void
  /** The field's own handlers. */
  input: {
    onChange: (event: { target: { value: string } }) => void
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
    onBlur: () => void
  }
}

/**
 * A one-line value edited in place (BTN-1111, BTN-1774): Enter, leaving the field, the card or the tab saves it; only
 * Escape drops the draft. `save` gets the typed text trimmed, empty too, and decides what to do with it.
 */
export function usePlaceEdit(save: (typed: string) => void | Promise<void>, drop?: () => void): PlaceEdit {
  const [draft, setDraft] = useState<string | null>(null)
  // The draft as of now: a blur after Enter or a closing tab must not send it twice.
  const typed = useRef<string | null>(null)
  const show = (text: string | null) => {
    typed.current = text
    setDraft(text)
  }
  const flush = async () => {
    const text = typed.current
    show(null)
    if (text !== null) await save(text.trim())
  }
  useLeaving(() => void flush())
  return {
    draft,
    show,
    input: {
      onChange: (event) => show(event.target.value),
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void flush()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          drop?.()
          show(null)
        }
      },
      onBlur: () => void flush(),
    },
  }
}
