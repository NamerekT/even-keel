import { MoreIcon } from './icons.js'
import { usePopoverMenu } from './usePopoverMenu.js'
import './moreMenu.css'

export interface MoreItem {
  label: string
  /** A destructive action: its line is in the error colour. */
  danger?: boolean
  /** Why it cannot be done now: the line stays, greyed, with the reason under it. */
  problem?: string
  pick: () => void
}

const EDGE = 8
const GAP = 4

/** Under the button, its right edge at the button's, so a ⋯ at a card's right corner opens inwards. */
function placeEnd(element: HTMLElement, at: DOMRect) {
  const width = element.offsetWidth
  const height = element.offsetHeight
  const left = Math.min(Math.max(EDGE, at.right - width), window.innerWidth - width - EDGE)
  const below = at.bottom + GAP
  const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, at.top - GAP - height)
  element.style.left = `${left}px`
  element.style.top = `${top}px`
}

/** The rare and destructive actions of a card behind a ⋯ button (`docs/design.md`, "Buttons"). */
export function MoreMenu({ items, label, disabled = false }: { items: MoreItem[]; label: string; disabled?: boolean }) {
  const { open, setOpen, root, button, menu, onKeyDown } = usePopoverMenu<HTMLUListElement>(placeEnd)
  if (items.length === 0) return null
  return (
    <div className="more-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="button button--small more-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      <ul ref={menu} popover="manual" role="menu" className="more-menu__list" onKeyDown={onKeyDown}>
        {open &&
          items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={item.danger === true ? 'more-menu__item more-menu__item--danger' : 'more-menu__item'}
                // Not `disabled`: a disabled button takes no focus, and its line says why it cannot be done.
                aria-disabled={item.problem !== undefined}
                onClick={() => {
                  if (item.problem !== undefined) return
                  setOpen(false)
                  item.pick()
                }}
              >
                <span className="more-menu__label">{item.label}</span>
                {item.problem !== undefined && <span className="more-menu__why">{item.problem}</span>}
              </button>
            </li>
          ))}
      </ul>
    </div>
  )
}
