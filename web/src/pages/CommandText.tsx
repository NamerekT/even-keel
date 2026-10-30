import { useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { commandIn, matchingCommands, type ChatCommand } from '../../../src/sessions/commands.js'
import { language, t } from '../i18n/index.js'
import { ghostOf, menuQuery, snappedSelection, tokenCut, withCommand } from './chatCommands.js'
import './chatCommands.css'

interface Props {
  value: string
  onChange: (text: string) => void
  rows: number
  disabled: boolean
  placeholder: string
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  /** Keys the commands menu did not take. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

/** Where a popover over the field stands, in the field's own coordinates. */
interface Spot {
  left: number
  bottom: number
}

/**
 * The chat's text field with its commands (BTN-557): a `/` at the start opens the menu, a picked command only goes into
 * the field, and a command there is drawn as one coloured piece with what may follow it muted. The colour comes from a
 * copy of the text behind the field, whose own text goes transparent while a command is in it.
 */
export function CommandText({ value, onChange, rows, disabled, placeholder, onPaste, onKeyDown }: Props) {
  const field = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const token = useRef<HTMLSpanElement>(null)
  const caret = useRef<number | null>(null)
  const menuId = useId()
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const [pointed, setPointed] = useState<{ name: string; top: number } | null>(null)
  const [tokenSpot, setTokenSpot] = useState<Spot | null>(null)

  const query = menuQuery(value)
  const options = query === null ? [] : matchingCommands(query)
  const open = focused && !disabled && options.length > 0 && dismissed !== value
  const chosen = Math.min(active, options.length - 1)
  const typed = commandIn(value)
  const ghost = ghostOf(value, language)

  useLayoutEffect(() => {
    if (caret.current === null || area.current === null) return
    area.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [value])

  const change = (text: string, at: number | null = null) => {
    caret.current = at
    setActive(0)
    setPointed(null)
    onChange(text)
  }
  const pick = (command: ChatCommand) => {
    const text = withCommand(value, command.name)
    change(text, text.length)
    area.current?.focus()
  }

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent
    if (open && !native.isComposing) {
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      if (step !== 0) {
        setActive((chosen + step + options.length) % options.length)
      } else if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        pick(options[chosen]!)
      } else if (event.key === 'Escape') {
        setDismissed(value)
      } else {
        onKeyDown(event)
        return
      }
      event.preventDefault()
      return
    }
    const box = event.currentTarget
    const cut = box.selectionStart === box.selectionEnd ? tokenCut(value, box.selectionStart, event.key) : null
    if (cut !== null) {
      event.preventDefault()
      change(cut.text, cut.caret)
      return
    }
    onKeyDown(event)
  }

  // A pointer over the command lights it up and shows its card; the field above it takes the pointer, so the spot is
  // measured on the copy behind it.
  const pointAt = (x: number, y: number) => {
    const rect = token.current?.getBoundingClientRect()
    const box = field.current?.getBoundingClientRect()
    const inside = rect !== undefined && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    setTokenSpot(inside && box !== undefined ? { left: rect.left - box.left, bottom: box.bottom - rect.top + 6 } : null)
  }

  const marked = typed !== null
  const head = typed === null ? '' : value.slice(0, typed.start)
  const name = typed === null ? '' : value.slice(typed.start, typed.end)
  const rest = typed === null ? value : value.slice(typed.end)
  const pointedCommand = pointed === null ? undefined : options.find((each) => each.name === pointed.name)

  return (
    <div ref={field} className={`chat__field${marked ? ' chat__field--marked' : ''}`}>
      {(marked || ghost !== null) && (
        <div ref={mirror} className="chat__mirror" aria-hidden>
          {head}
          {typed !== null && (
            <span ref={token} className={`chat__command${tokenSpot !== null ? ' chat__command--hover' : ''}`}>
              {name}
            </span>
          )}
          {rest}
          {ghost !== null && (
            <span className="chat__ghost">
              {ghost.gap ? ' ' : ''}
              {ghost.kind === 'filter' ? t.session.chat.commands.filter : ghost.text}
            </span>
          )}
          {value.endsWith('\n') && ghost === null ? '​' : ''}
        </div>
      )}
      <textarea
        ref={area}
        className="chat__text"
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        role={open ? 'combobox' : undefined}
        aria-expanded={open ? true : undefined}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open ? `${menuId}-${chosen}` : undefined}
        onChange={(event) => change(event.target.value)}
        onPaste={onPaste}
        onKeyDown={keyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          setTokenSpot(null)
        }}
        onScroll={(event) => {
          if (mirror.current !== null) mirror.current.scrollTop = event.currentTarget.scrollTop
        }}
        onSelect={(event) => {
          const box = event.currentTarget
          const snapped = snappedSelection(value, box.selectionStart, box.selectionEnd)
          if (snapped !== null) box.setSelectionRange(...snapped)
        }}
        onMouseMove={(event) => (marked ? pointAt(event.clientX, event.clientY) : undefined)}
        onMouseLeave={() => setTokenSpot(null)}
      />
      {open && (
        <div className="chat__commands">
          <ul id={menuId} className="chat__commands-list" role="listbox" aria-label={t.session.chat.commands.menu} onMouseLeave={() => setPointed(null)}>
            {options.map((command, index) => (
              <li
                key={command.name}
                id={`${menuId}-${index}`}
                role="option"
                aria-selected={index === chosen}
                className={`chat__commands-item${index === chosen ? ' chat__commands-item--active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={(event) => {
                  setActive(index)
                  setPointed({ name: command.name, top: event.currentTarget.offsetTop - (event.currentTarget.parentElement?.scrollTop ?? 0) })
                }}
                onClick={() => pick(command)}
              >
                {command.name}
              </li>
            ))}
          </ul>
          {pointedCommand !== undefined && (
            <div className="chat__commands-tip" style={{ '--row-top': `${pointed!.top}px` } as CSSProperties} role="tooltip">
              {pointedCommand.description[language]}
            </div>
          )}
        </div>
      )}
      {typed !== null && tokenSpot !== null && (
        <div className="chat__command-card" style={{ left: tokenSpot.left, bottom: tokenSpot.bottom }} role="tooltip">
          <span className="chat__command-card-name">/{typed.command.name}</span>
          <span>{typed.command.description[language]}</span>
        </div>
      )}
    </div>
  )
}
