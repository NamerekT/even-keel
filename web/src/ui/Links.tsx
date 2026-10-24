import type { ReactNode } from 'react'
import { t } from '../i18n/index.js'
import type { LinkedTask, TaskLinks } from '../state.js'
import { KeyIcon, LockIcon } from './icons.js'
import { Lamp } from './Lamp.js'
import { useTip } from './useTip.js'
import './links.css'

/** Two counters, the tasks this one waits for and the tasks waiting for it; a pointed counter lists them. */
export function Links({ links, onCard }: { links: TaskLinks; onCard: (task: string) => void }) {
  return (
    <span className="links">
      <Count kind="blockers" title={t.card.blockedBy} icon={<LockIcon />} items={links.blockers} onCard={onCard} />
      <Count kind="dependents" title={t.card.blocks} icon={<KeyIcon />} items={links.dependents} onCard={onCard} />
    </span>
  )
}

interface CountProps {
  kind: 'blockers' | 'dependents'
  title: string
  icon: ReactNode
  items: LinkedTask[]
  onCard: (task: string) => void
}

function Count({ kind, title, icon, items, onCard }: CountProps) {
  const any = items.length > 0
  const { shown, anchor, tip, show, point, hide, close } = useTip<HTMLSpanElement, HTMLSpanElement>(any)

  return (
    <span
      ref={anchor}
      className={`links__count links__count--${kind}${any ? '' : ' links__count--none'}`}
      tabIndex={any ? 0 : undefined}
      aria-label={`${title}: ${any ? items.map((item) => item.id).join(', ') : 0}`}
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
