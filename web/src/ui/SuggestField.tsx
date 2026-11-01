import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon } from './icons.js'
import { place } from './Select.js'
import { offersOf, stepOf, type Offer } from './selectKeys.js'
import './select.css'
import './suggest.css'

export type { Offer }

interface SuggestFieldProps {
  value: string
  /** Offered in the list; any other value may still be typed. A string is a value without a label. */
  options: readonly (string | Offer)[]
  onChange: (value: string) => void
  id?: string
  /** The look of the field, e.g. `settings__text settings__text--mono`. */
  className?: string
  /** The name when no `<label>` points at it. */
  label?: string
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  /** The values in the list in monospace, as the field shows them. */
  mono?: boolean
  /** A key the list did not take: Enter with no option active, Escape with the list closed. */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}

/**
 * A text field with suggestions instead of the native datalist (BTN-583): focus selects the whole value, so typing
 * replaces it; the list opened by focus, a click or an arrow shows every option and narrows only once the user types.
 * The list opens in the top layer like `Select`'s. Arrows move through it, Enter picks, Escape closes the list alone.
 */
export function SuggestField({ value, options, onChange, id, className = '', label, placeholder, invalid = false, disabled = false, mono = false, onKeyDown }: SuggestFieldProps) {
  const [open, setOpen] = useState(false)
  // `null` until the user types: the list then shows every option, whatever the field holds.
  const [typed, setTyped] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const field = useRef<HTMLInputElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  // A press that focuses the field: its release would drop the selection the focus made.
  const focusing = useRef(false)
  // A modal <dialog> makes everything outside it inert, so a list in the body would show but take no clicks.
  const [host, setHost] = useState<HTMLElement | null>(null)
  const listId = useId()
  const offers = options.map((option) => (typeof option === 'string' ? { value: option } : option))
  const shown = offersOf(offers, typed)
  const visible = open && shown.length > 0
  const optionId = (index: number) => `${listId}-${index}`

  useLayoutEffect(() => setHost(field.current?.closest('dialog') ?? document.body), [])

  useLayoutEffect(() => {
    const element = popup.current
    if (!visible || element === null) return
    element.showPopover()
    const away = (event: Event) => {
      if (!(event.target instanceof Node && element.contains(event.target))) setOpen(false)
    }
    const shut = () => setOpen(false)
    // A scroll inside the list keeps it; the page scrolling away from the field closes it.
    document.addEventListener('scroll', away, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', shut)
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [visible])

  // Typing narrows the list; it is placed again, so one opened above the field stays glued to it.
  useLayoutEffect(() => {
    const owner = field.current
    if (visible && popup.current !== null && owner !== null) place(popup.current, owner.getBoundingClientRect())
  }, [visible, shown.length])

  // Only the list scrolls to the active option: `scrollIntoView` would scroll the page too, and that closes the list.
  useEffect(() => {
    const box = list.current
    const item = box?.children[active]
    if (!visible || box === null || !(item instanceof HTMLElement)) return
    const top = item.offsetTop - box.offsetTop
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + item.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + item.offsetHeight - box.clientHeight
  }, [visible, active])

  const show = () => {
    setTyped(null)
    setActive(offersOf(offers, null).findIndex((option) => option.value === value))
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setTyped(null)
    setActive(-1)
  }
  const pick = (index: number) => {
    const option = shown[index]
    if (option === undefined) return
    if (option.value !== value) onChange(option.value)
    close()
    const input = field.current
    if (input !== null) requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length))
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const { key } = event
    const arrow = key === 'ArrowDown' || key === 'ArrowUp'
    if (key === 'Escape' && visible) {
      event.preventDefault()
      // The panel or the dialog around would take the same Escape as its own close.
      event.stopPropagation()
      close()
    } else if (key === 'Enter' && visible && active >= 0) {
      event.preventDefault()
      pick(active)
    } else if (arrow && !visible) {
      event.preventDefault()
      show()
    } else if (arrow) {
      event.preventDefault()
      setActive(stepOf(key, active, shown.length) ?? -1)
    } else {
      if (key === 'Tab' || key === 'Enter') close()
      onKeyDown?.(event)
    }
  }

  return (
    <>
      <input
        ref={field}
        id={id}
        className={className}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onPointerDown={() => {
          focusing.current = document.activeElement !== field.current
        }}
        onMouseUp={(event) => {
          if (focusing.current) event.preventDefault()
          focusing.current = false
        }}
        onFocus={(event) => {
          event.target.select()
          show()
        }}
        onClick={() => !open && show()}
        onBlur={close}
        onChange={(event) => {
          setTyped(event.target.value)
          setActive(-1)
          setOpen(true)
          onChange(event.target.value)
        }}
        onKeyDown={keyDown}
      />
      {/* Out of the field's place: a <label> around it would take a press on an option as a click on the field. */}
      {host !== null &&
        createPortal(
          <div ref={popup} popover="manual" className="select__list">
            <ul ref={list} id={listId} role="listbox" className={mono ? 'select__options suggest__options--mono' : 'select__options'} aria-label={label}>
              {visible &&
                shown.map((option, index) => (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    className="select__option"
                    aria-selected={option.value === value}
                    data-active={index === active}
                    // The focus stays in the field, whose keys drive the list.
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => index !== active && setActive(index)}
                    onClick={() => pick(index)}
                  >
                    <span className="select__label">
                      {option.value}
                      {option.label !== undefined && option.label !== option.value && <span className="suggest__note">{option.label}</span>}
                    </span>
                    {option.value === value && <CheckIcon />}
                  </li>
                ))}
            </ul>
          </div>,
          host,
        )}
    </>
  )
}
