import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, ChevronIcon } from './icons.js'
import { matchOf, stepOf } from './selectKeys.js'
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
}

const TYPING_MS = 500
const GAP = 4
const EDGE = 8

/**
 * A pick from a list instead of the native select: a combobox button whose options open in the top layer,
 * so a panel or a table cell does not clip them. Keys as in a native select: arrows, Home, End, Enter, Space, Escape, typing.
 */
export function Select({ value, options, onChange, id, className = '', label, invalid = false, disabled = false }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: -Infinity })
  const listId = useId()
  const chosen = options.findIndex((option) => option.value === value)
  const optionId = (index: number) => `${listId}-${index}`

  useLayoutEffect(() => {
    const element = list.current
    const owner = button.current
    if (!open || element === null || owner === null) return
    element.showPopover()
    place(element, owner.getBoundingClientRect())
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

  useEffect(() => {
    if (open && active >= 0) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const show = (at: number) => {
    setActive(at)
    setOpen(true)
  }
  const pick = (index: number) => {
    const option = options[index]
    if (option !== undefined && option.value !== value) onChange(option.value)
    setOpen(false)
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

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event
    const printable = key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
    if (open && key === 'Escape') {
      event.preventDefault()
      // The panel around would take the same Escape as its own close.
      event.stopPropagation()
      setOpen(false)
    } else if (open && key === 'Tab') {
      setOpen(false)
    } else if (key === 'Enter' || (key === ' ' && !typing(event)) || (!open && (key === 'ArrowDown' || key === 'ArrowUp'))) {
      event.preventDefault()
      if (open) pick(active)
      else show(Math.max(chosen, 0))
    } else if (printable) {
      event.preventDefault()
      type(event)
    } else {
      const step = stepOf(key, open ? active : chosen, options.length)
      if (step === undefined) return
      event.preventDefault()
      show(step)
    }
  }

  const current = options[chosen]
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
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show(Math.max(chosen, 0)))}
        onKeyDown={onKeyDown}
        // Space on a button clicks it on release; the press already opened or picked.
        onKeyUp={(event) => event.key === ' ' && event.preventDefault()}
      >
        <span className="select__value">{current?.label ?? value}</span>
        <ChevronIcon />
      </button>
      {/* In the body: inside a <label> a press on an option would also click the button and open the list again. */}
      {createPortal(
        <ul ref={list} id={listId} popover="manual" role="listbox" className="select__list" aria-label={label}>
          {open &&
            options.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                className="select__option"
                aria-selected={index === chosen}
                data-active={index === active}
                // The focus stays on the button, whose keys drive the list.
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => index !== active && setActive(index)}
                onClick={() => pick(index)}
              >
                <span className="select__label">{option.label}</span>
                {index === chosen && <CheckIcon />}
              </li>
            ))}
        </ul>,
        document.body,
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
