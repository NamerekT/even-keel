import { useState } from 'react'
import { Link } from 'react-router'
import type { BatonState } from '../../../src/state.js'
import { useLive } from '../live/context.js'
import { cardTask, chainProgress, chainStatus, projectSlot, projectTasks, type ChainStatus } from '../state.js'
import { Lamp } from '../ui/Lamp.js'
import { seriesStyle } from '../ui/series.js'

const STATUS_LABELS: Record<ChainStatus['kind'], string> = {
  running: 'идёт',
  paused: 'пауза',
  queued: 'в очереди',
  idle: 'не запущена',
}

export function ProjectCard({ state, project }: { state: BatonState; project: string }) {
  const { command } = useLive()
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const status = chainStatus(state.chain, project)
  const order = state.chain.projects[project]
  const { done, total } = chainProgress(projectTasks(state, project))
  const task = cardTask(state, project)
  const slot = projectSlot(state.projects, project)
  const canStart = status.kind === 'idle' && order !== undefined && order.error === null && order.order.length > 0
  const error = order?.error ?? (status.kind === 'paused' ? status.error : null) ?? failure

  const start = async () => {
    setSending(true)
    setFailure(null)
    try {
      await command('start', { project })
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSending(false)
    }
  }

  return (
    <article className={`card card--${status.kind}`} style={seriesStyle(slot)}>
      <header className="card__head">
        <span className="card__swatch" aria-hidden="true" />
        <Link to={`/p/${project}`} className="card__key">
          {project}
        </Link>
        <span className={`chip chip--${status.kind}`}>
          {STATUS_LABELS[status.kind]}
          {status.kind === 'queued' && <span className="chip__extra"> · {status.position}-я</span>}
        </span>
      </header>

      <div className="card__progress">
        <span
          className="card__bar"
          role="progressbar"
          aria-label="Готово задач"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
        >
          <span className="card__fill" style={{ width: total === 0 ? '0%' : `${(done / total) * 100}%` }} />
        </span>
        <span className="card__count">
          <strong>{done}</strong> / {total}
        </span>
      </div>

      {task === null ? (
        <p className="card__task card__task--empty">{order === undefined ? 'Задачи ещё не загружены' : 'Открытых задач нет'}</p>
      ) : (
        <p className="card__task">
          <Lamp lamp={task.lamp} />
          <span className="card__task-label">{task.next ? 'Следующая' : 'Сейчас'}</span>
          <span className="card__task-id">{task.id}</span>
          {task.title !== null && <span className="card__task-title">{task.title}</span>}
        </p>
      )}

      {error !== null && <p className="card__error">{error}</p>}

      {canStart && (
        <footer className="card__foot">
          <button type="button" className="button button--primary" disabled={sending} onClick={() => void start()}>
            {state.chain.active === null ? 'Запустить' : 'В очередь'}
          </button>
        </footer>
      )}
    </article>
  )
}
