import { useEffect, useRef, type SyntheticEvent } from 'react'
import type { TrackerUrls } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { issueLink, type TaskLinks } from '../state.js'
import { FlagIcon, IntoChainIcon, StackIcon } from '../ui/icons.js'
import { Links } from '../ui/Links.js'
import { PriorityIcon } from '../ui/Priority.js'
import type { Box } from '../ui/reorder.js'
import './backlog.css'

/** The address hash that opens the backlog panel; a task id never equals it. */
export const BACKLOG_HASH = 'backlog'

/** `tab` — a tab on the side column's card instead of a tag in the head row. */
export function BacklogChip({ count, open, tab = false, onToggle }: { count: number; open: boolean; tab?: boolean; onToggle: () => void }) {
  if (count === 0) return null
  return (
    <button
      type="button"
      className={tab ? 'side-tab side-tab--wide' : 'tag tag--backlog'}
      aria-expanded={open}
      title={t.project.backlogHint}
      onClick={onToggle}
    >
      <StackIcon />
      {t.project.backlog(count)}
    </button>
  )
}

interface Props {
  tasks: Task[]
  trackerUrls: TrackerUrls
  /** The project's tracker can move a backlog task to Todo. */
  canReady: boolean
  links: (task: string) => TaskLinks
  onCard: (task: string) => void
  onClose: () => void
  /** The task whose Todo button is pointed at, `null` when none is. */
  onPoint: (task: string | null) => void
  onMove: (task: Task, from: Box) => void
  /** The Todo command for the task has been answered. */
  onSettled: (task: string) => void
}

export function BacklogPanel({ tasks, trackerUrls, canReady, links, onCard, onClose, onPoint, onMove, onSettled }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const { send, sending, failure } = useCommand()
  const point = useRef(onPoint)
  point.current = onPoint
  const mixed = new Set(tasks.map((task) => task.status.name)).size > 1

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])
  useEffect(() => () => point.current(null), [])

  // mousemove, not mouseenter: Chrome fires a synthetic enter when the row under a still cursor disappears.
  const pointAt = (event: SyntheticEvent) => onPoint((event.target as HTMLElement).closest<HTMLElement>('[data-ready]')?.dataset.ready ?? null)
  const ready = (task: Task, button: HTMLElement) => {
    const row = button.closest('li')?.getBoundingClientRect()
    if (row !== undefined) onMove(task, { left: row.left, top: row.top, width: row.width, height: row.height })
    void send('task/ready', { task: task.id }).then(() => onSettled(task.id))
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="panel backlog" aria-label={t.project.backlog(tasks.length)}>
      <header className="panel__head">
        <h2 className="panel__task backlog__title">
          <StackIcon />
          {t.project.backlog(tasks.length)}
        </h2>
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      <p className="chain__hint">{t.project.backlogHint}</p>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <ol
        className={canReady ? 'backlog__list backlog__list--ready' : 'backlog__list'}
        onMouseMove={pointAt}
        onFocus={pointAt}
        onMouseLeave={() => onPoint(null)}
        onBlur={() => onPoint(null)}
      >
        {tasks.map((task) => {
          const link = issueLink(trackerUrls, task.id)
          return (
            <li key={task.id} className={`backlog__row backlog__row--${task.priority}`}>
              {canReady && task.status.category === 'UnStarted' && (
                <button
                  type="button"
                  className="backlog__ready"
                  disabled={sending}
                  aria-label={t.card.ready}
                  data-ready={task.id}
                  onClick={(event) => ready(task, event.currentTarget)}
                >
                  <IntoChainIcon />
                </button>
              )}
              <div className="backlog__meta">
                <span className="backlog__priority" title={`${t.card.priority}: ${t.card.priorities[task.priority]}`}>
                  <PriorityIcon priority={task.priority} />
                </span>
                {link === null ? (
                  <span className="backlog__key">{task.id}</span>
                ) : (
                  <a href={link} className="backlog__key" target="_blank" rel="noreferrer">
                    {task.id}
                  </a>
                )}
                {mixed && <span className="backlog__status">{task.status.name}</span>}
                <span
                  className={task.milestone === null ? 'backlog__milestone backlog__milestone--none' : 'backlog__milestone'}
                  title={t.card.milestone}
                >
                  <FlagIcon />
                  <span className="backlog__milestone-name">{task.milestone?.label ?? t.chain.noMilestone}</span>
                </span>
                <Links links={links(task.id)} onCard={onCard} />
              </div>
              <button type="button" className="backlog__name" title={t.chain.openCard} onClick={() => onCard(task.id)}>
                {task.title}
              </button>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
