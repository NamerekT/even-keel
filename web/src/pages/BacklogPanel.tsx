import { useEffect, useRef } from 'react'
import type { TrackerUrls } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { issueLink } from '../state.js'
import { StackIcon } from '../ui/icons.js'
import './backlog.css'

/** The address hash that opens the backlog panel; a task id never equals it. */
export const BACKLOG_HASH = 'backlog'

export function BacklogChip({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  if (count === 0) return null
  return (
    <button
      type="button"
      className="chip chip--backlog"
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
  onCard: (task: string) => void
  onClose: () => void
}

export function BacklogPanel({ tasks, trackerUrls, canReady, onCard, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const { send, sending, failure } = useCommand()

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])

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
      <ol className="backlog__list">
        {tasks.map((task) => {
          const link = issueLink(trackerUrls, task.id)
          return (
            <li key={task.id} className="backlog__row">
              <div className="backlog__meta">
                {link === null ? (
                  <span className="backlog__key">{task.id}</span>
                ) : (
                  <a href={link} className="backlog__key" target="_blank" rel="noreferrer">
                    {task.id}
                  </a>
                )}
                <span className="backlog__status">{task.status.name}</span>
              </div>
              <button type="button" className="backlog__name" title={t.chain.openCard} onClick={() => onCard(task.id)}>
                {task.title}
              </button>
              {canReady && task.status.category === 'UnStarted' && (
                <button
                  type="button"
                  className="button backlog__ready"
                  disabled={sending}
                  title={t.card.readyHint}
                  onClick={() => void send('task/ready', { task: task.id })}
                >
                  {t.card.ready}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
