import { useState } from 'react'
import type { TrackerUrls } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import { t } from '../i18n/index.js'
import { issueLink } from '../state.js'
import { Lamp } from '../ui/Lamp.js'

const OPEN_KEY = 'even-keel.backlog.open'

interface Props {
  tasks: Task[]
  trackerUrls: TrackerUrls
  onCard: (task: string) => void
}

export function BacklogList({ tasks, trackerUrls, onCard }: Props) {
  const [open, setOpen] = useState(readOpen)
  if (tasks.length === 0) return null

  const toggle = (next: boolean) => {
    if (next === open) return
    setOpen(next)
    try {
      localStorage.setItem(OPEN_KEY, String(next))
    } catch {}
  }

  return (
    <details className="backlog" open={open} onToggle={(event) => toggle(event.currentTarget.open)}>
      <summary className="backlog__summary">{t.project.backlog(tasks.length)}</summary>
      <ol className="chain__blocks backlog__blocks">
        {tasks.map((task) => {
          const link = issueLink(trackerUrls, task.id)
          return (
            <li key={task.id} className="block block--backlog">
              <span className="block__number" />
              <div className="block__head">
                <Lamp lamp="ahead" />
                {link === null ? (
                  <span className="block__key">{task.id}</span>
                ) : (
                  <a href={link} className="block__key" target="_blank" rel="noreferrer">
                    {task.id}
                  </a>
                )}
              </div>
              <p className="block__title">
                <button type="button" className="block__card" title={t.chain.openCard} onClick={() => onCard(task.id)}>
                  {task.title}
                </button>
              </p>
              <div className="block__side">
                <span className="block__status">{task.status.name}</span>
              </div>
            </li>
          )
        })}
      </ol>
      <p className="chain__hint">{t.project.backlogHint}</p>
    </details>
  )
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'true'
  } catch {
    return false
  }
}
