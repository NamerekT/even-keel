import type { TrackerPage } from '../state.js'
import { t } from '../i18n/index.js'
import { ChevronIcon, TrackerIcon } from './icons.js'
import { usePopoverMenu } from './usePopoverMenu.js'
import './trackerPages.css'

const EDGE = 8
const GAP = 4

/**
 * Under the button, its right edge at the button's, so at a card's right corner it opens inwards; above it when there is
 * more room there. A list taller than either room is cut to it and scrolls inside.
 */
function placeEnd(element: HTMLElement, at: DOMRect) {
  element.style.maxHeight = ''
  const width = element.offsetWidth
  const height = element.offsetHeight
  const left = Math.min(Math.max(EDGE, at.right - width), window.innerWidth - width - EDGE)
  const below = window.innerHeight - EDGE - (at.bottom + GAP)
  const above = at.top - GAP - EDGE
  const down = height <= below || below >= above
  const room = down ? below : above
  if (height > room) element.style.maxHeight = `${room}px`
  element.style.left = `${left}px`
  element.style.top = `${down ? at.bottom + GAP : at.top - GAP - Math.min(height, room)}px`
}

/**
 * Where a project's tasks are filed (`projectPages`): one tracker is a plain "Open in Huly" button, two and more are one
 * "Open in…" button whose list names each tracker with its icon, every line a link in a new tab.
 */
export function TrackerPages({ pages, small = false }: { pages: readonly TrackerPage[]; small?: boolean }) {
  const { open, setOpen, root, button, menu, onKeyDown } = usePopoverMenu<HTMLUListElement>(placeEnd)
  const look = small ? 'button button--small' : 'button'
  if (pages.length === 0) return null
  if (pages.length === 1) {
    const [page] = pages
    return (
      <a className={`${look} tracker-pages__one`} href={page!.url} target="_blank" rel="noreferrer">
        {t.project.openIn(page!.tracker)}
      </a>
    )
  }
  return (
    <div className="tracker-pages" ref={root}>
      <button ref={button} type="button" className={`${look} tracker-pages__button`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t.project.openInList}
        <ChevronIcon />
      </button>
      <ul ref={menu} popover="manual" role="menu" aria-label={t.project.openInList} className="tracker-pages__list" onKeyDown={onKeyDown}>
        {open &&
          pages.map((page) => (
            <li key={page.url} role="none">
              <a role="menuitem" className="tracker-pages__item" href={page.url} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                <TrackerIcon kind={page.kind ?? ''} />
                <span className="tracker-pages__label">{page.tracker ?? t.project.trackerUnnamed}</span>
              </a>
            </li>
          ))}
      </ul>
    </div>
  )
}
