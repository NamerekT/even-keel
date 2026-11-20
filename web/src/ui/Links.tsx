import type { ReactNode } from 'react'
import { t } from '../i18n/index.js'
import type { LinkedTask, TaskLinks } from '../state.js'
import { KeyIcon, LockIcon } from './icons.js'
import { Lamp } from './Lamp.js'
import { useTip } from './useTip.js'
import './links.css'

interface LinksProps {
  links: TaskLinks
  onCard: (task: string) => void
  /** The lock above the key in one narrow column, as a chain row draws them (BTN-1365). */
  stack?: boolean | undefined
}

/**
 * The tasks this one waits for (a lock) and the tasks waiting for it (a key); a pointed counter lists them.
 * A zero is not drawn and keeps no place: a task without links draws nothing (BTN-1365).
 */
export function Links({ links, onCard, stack = false }: LinksProps) {
  const { blockers, dependents } = links
  if (blockers.length === 0 && dependents.length === 0) return null
  return (
    <span className={stack ? 'links links--stack' : 'links'}>
      {blockers.length > 0 && <Count kind="blockers" title={t.card.blockedBy} icon={<LockIcon />} items={blockers} onCard={onCard} />}
      {dependents.length > 0 && <Count kind="dependents" title={t.card.blocks} icon={<KeyIcon />} items={dependents} onCard={onCard} />}
    </span>
  )
}

/** Whether a task has a lock or a key to draw. */
export function hasLinks(links: TaskLinks): boolean {
  return links.blockers.length > 0 || links.dependents.length > 0
}

interface CountProps {
  kind: 'blockers' | 'dependents'
  title: string
  icon: ReactNode
  items: LinkedTask[]
  onCard: (task: string) => void
}

function Count({ kind, title, icon, items, onCard }: CountProps) {
  const { shown, anchor, tip, show, point, hide, close } = useTip<HTMLSpanElement, HTMLSpanElement>()

  return (
    <span
      ref={anchor}
      className={`links__count links__count--${kind}`}
      tabIndex={0}
      aria-label={`${title}: ${items.map((item) => item.id).join(', ')}`}
      onMouseEnter={point}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={show}
      onKeyDown={(event) => event.key === 'Escape' && close()}
    >
      {icon}
      <span className="links__number">{items.length}</span>
      {shown && (
        <span ref={tip} popover="manual" className="links__tip" role="tooltip">
          <span className="links__heading">
            {title} <span className="links__total">{items.length}</span>
          </span>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="links__task"
              tabIndex={-1}
              onClick={() => {
                close()
                onCard(item.id)
              }}
            >
              <Lamp lamp={item.lamp} />
              <span className="links__key">{item.id}</span>
              {item.title !== null && <span className="links__title">{item.title}</span>}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}
