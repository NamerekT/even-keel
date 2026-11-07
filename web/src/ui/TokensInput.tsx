import { useLayoutEffect, useRef } from 'react'
import { shownCaret, tokensOf, tokensShown, typedTokens } from './tokens.js'

interface Props {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  label?: string
}

/**
 * A token count: thousands grouped as they are typed, `300k` taken and turned into digits on leaving the field.
 * The value it hands on has no separators, so a count typed back as it was is no change.
 */
export function TokensInput({ id, value, onChange, placeholder, disabled, invalid, label }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const shown = tokensShown(value)

  useLayoutEffect(() => {
    if (caret.current === null || input.current === null || document.activeElement !== input.current) return
    input.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })

  return (
    <input
      ref={input}
      id={id}
      className="settings__text settings__number"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      value={shown}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid}
      onChange={(event) => {
        const kind = (event.nativeEvent as InputEvent).inputType
        const removed = kind === 'deleteContentBackward' ? 'backward' : kind === 'deleteContentForward' ? 'forward' : null
        const target = event.target
        const next = typedTokens(target.value, target.selectionStart ?? target.value.length, value, removed)
        caret.current = shownCaret(next.value, next.caret)
        onChange(next.value)
      }}
      onBlur={() => {
        const count = tokensOf(value)
        if (count !== undefined && String(count) !== value) onChange(String(count))
      }}
    />
  )
}
