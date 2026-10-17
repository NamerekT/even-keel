import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, ChevronIcon } from './icons.js'
import { filterOf, matchOf, stepOf } from './selectKeys.js'
import './select.css'

export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  id?: string
  /** The look of the field it stands in, e.g. `settings__text`. */
  className?: string
  /** The name when no `<label>` points at it. */
  label?: string
  invalid?: boolean
  disabled?: boolean
  /** A search field atop the open list, for a list too long to scroll: its placeholder and the line when nothing fits. */
  search?: { placeholder: string; none: string }
}

const TYPING_MS = 500
const GAP = 4
const EDGE = 8

/**
 * A pick from a list instead of the native select: a combobox button whose options open in the top layer,
 * so a panel or a table cell does not clip them. Keys as in a native select: arrows, Home, End, Enter, Space, Escape, typing.
 * With `search`, typing goes into the field atop the list and narrows it instead.
 */
export function Select({ value, options, onChange, id, className = '', label, invalid = false, disabled = false, search }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [query, setQuery] = useState('')
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const typed = useRef({ text: '', at: -Infinity })
  // A modal <dialog> makes everything outside it inert, so a list in the body would show but take no clicks.
  const [host, setHost] = useState<HTMLElement | null>(null)
  const listId = useId()
  const shown = useMemo(
    () => (search === undefined ? options : filterOf(options.map((option) => option.label), query).map((index) => options[index]!)),
    [options, query, search],
  )
  const chosen = shown.findIndex((option) => option.value === value)
  const optionId = (index: number) => `${listId}-${index}`

  useLayoutEffect(() => {
    const element = popup.current
    const owner = button.current
    if (!open || element === null || owner === null) return
    element.showPopover()
    element.style.width = ''
    place(element, owner.getBoundingClientRect())
    // A search narrows the list; the width it opened with stays, so the list does not jump under the typing.
    if (search !== undefined) element.style.width = `${element.offsetWidth}px`
    const input = field.current
    if (input !== null) {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
    const away = (event: Event) => {
      if (!(event.target instanceof Node && (owner.contains(event.target) || element.contains(event.target)))) setOpen(false)
    }
    const shut = () => setOpen(false)
    document.addEventListener('pointerdown', away)
    // A scroll inside the list keeps it; the page scrolling away from the button closes it.
    document.addEventListener('scroll', away, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('scroll', away, true)
      window.removeEventListener('resize', shut)
      if (element.matches(':popover-open')) element.hidePopover()
    }
  }, [open])

  useLayoutEffect(() => {
    const owner = button.current
    if (open && search !== undefined && popup.current !== null && owner !== null) place(popup.current, owner.getBoundingClientRect())
  }, [open, search, shown.length])

  useLayoutEffect(() => setHost(button.current?.closest('dialog') ?? document.body), [])

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const show = (at: number) => {
    setActive(at)
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    setQuery('')
    if (refocus && search !== undefined) button.current?.focus()
  }
  const pick = (index: number) => {
    const option = shown[index]
    if (option !== undefined && option.value !== value) onChange(option.value)
    close(true)
  }
  const typing = (event: KeyboardEvent) => event.timeStamp - typed.current.at < TYPING_MS && typed.current.text !== ''
  const type = (event: KeyboardEvent) => {
    const text = typing(event) ? typed.current.text + event.key : event.key
    typed.current = { text, at: event.timeStamp }
    const match = matchOf(
      options.map((option) => option.label),
      text,
      open ? active : chosen,
    )
    if (match >= 0) show(match)
  }
  const narrow = (text: string) => {
    setQuery(text)
    setActive(0)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event
    const printable = key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
    if (open && key === 'Escape') {
      event.preventDefault()
      // The panel around would take the same Escape as its own close.
      event.stopPropagation()
      close(false)
    } else if (open && key === 'Tab') {
      close(false)
    } else if (search !== undefined && printable && key !== ' ') {
      event.preventDefault()
      narrow(key)
      setOpen(true)
    } else if (key === 'Enter' || (key === ' ' && !typing(event)) || (!open && (key === 'ArrowDown' || key === 'ArrowUp'))) {
      event.preventDefault()
      if (open) pick(active)
      else show(Math.max(chosen, 0))
    } else if (printable) {
      event.preventDefault()
      type(event)
    } else {
      const step = stepOf(key, open ? active : chosen, shown.length)
      if (step === undefined) return
      event.preventDefault()
      show(step)
    }
  }

  // Home and End stay with the text of the field.
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const { key } = event
    if (key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (key === 'Tab') {
      // Back on the button before the browser moves on, so Tab goes to the field after it.
      close(true)
    } else if (key === 'Enter') {
      event.preventDefault()
      if (active >= 0) pick(active)
    } else if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      setActive(stepOf(key, active, shown.length) ?? -1)
    }
  }

  const current = options.find((option) => option.value === value)
  return (
    <>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        className={`select ${className}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 && search === undefined ? optionId(active) : undefined}
        aria-invalid={invalid}
        disabled={disabled}
        onClick={() => (open ? close(false) : show(Math.max(chosen, 0)))}
        onKeyDown={onKeyDown}
        // Space on a button clicks it on release; the press already opened or picked.
        onKeyUp={(event) => event.key === ' ' && event.preventDefault()}
      >
        <span className="select__value">{current?.label ?? value}</span>
        <ChevronIcon />
      </button>
      {/* Out of the field: inside a <label> a press on an option would also click the button and open the list again. */}
      {host !== null &&
        createPortal(
          <div ref={popup} popover="manual" className="select__list">
            {open && search !== undefined && (
              <input
                ref={field}
                className="select__search"
                type="search"
                value={query}
                placeholder={search.placeholder}
                aria-label={search.placeholder}
                aria-controls={listId}
                aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => narrow(event.target.value)}
                onKeyDown={onSearchKeyDown}
              />
            )}
            <ul ref={list} id={listId} role="listbox" className="select__options" aria-label={label}>
              {open &&
                shown.map((option, index) => (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    className="select__option"
                    aria-selected={option.value === value}
                    data-active={index === active}
                    // The focus stays on the button or the search field, whose keys drive the list.
                    onPointerDown={(event) => event.preventDefault()}
                    onPointerMove={() => index !== active && setActive(index)}
                    onClick={() => pick(index)}
                  >
                    <span className="select__label">{option.label}</span>
                    {option.value === value && <CheckIcon />}
                  </li>
                ))}
            </ul>
            {open && search !== undefined && shown.length === 0 && <p className="select__none">{search.none}</p>}
          </div>,
          host,
        )}
    </>
  )
}

/** Under the button and at least as wide, its left edge on the button's; above it when the viewport ends first. */
export function place(element: HTMLElement, at: DOMRect) {
  element.style.minWidth = `${at.width}px`
  const width = element.offsetWidth
  const height = element.offsetHeight
  const left = Math.min(Math.max(EDGE, at.left), window.innerWidth - width - EDGE)
  const below = at.bottom + GAP
  const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, at.top - GAP - height)
  element.style.left = `${left}px`
  element.style.top = `${top}px`
}
