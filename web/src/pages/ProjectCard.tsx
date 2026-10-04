import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { cardTask, chainProgress, chainStatus, limitWaitText, openQuestions, projectSlot, projectTasks } from '../state.js'
import { Lamp } from '../ui/Lamp.js'
import { QuestionsChip } from '../ui/QuestionsChip.js'
import { seriesStyle } from '../ui/series.js'
import { StatusChip } from '../ui/StatusChip.js'

export function ProjectCard({ state, project }: { state: EvenKeelState; project: string }) {
  const { send, sending, failure } = useCommand()

  const status = chainStatus(state.chain, project)
  const order = state.chain.projects[project]
  const { done, total } = chainProgress(projectTasks(state, project))
  const task = cardTask(state, project)
  const slot = projectSlot(state.projects, project)
  const canStart = status.kind === 'idle' && order !== undefined && order.error === null && order.order.length > 0
  const error = order?.error ?? (status.kind === 'paused' ? status.error : null) ?? failure

  return (
    <article className={`card card--${status.kind}`} style={seriesStyle(slot)}>
      <header className="card__head">
        <span className="card__swatch" aria-hidden="true" />
        <Link to={`/p/${project}`} className="card__key">
          {project}
        </Link>
        <StatusChip status={status} />
        <QuestionsChip count={openQuestions(projectTasks(state, project))} />
      </header>

      <div className="card__progress">
        <span
          className="card__bar"
          role="progressbar"
          aria-label={t.project.done}
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
        <p className="card__task card__task--empty">{order === undefined ? t.project.notLoaded : t.project.noTasks}</p>
      ) : (
        <p className="card__task">
          <Lamp lamp={task.lamp} />
          <span className="card__task-label">{task.next ? t.project.next : t.project.now}</span>
          <span className="card__task-id">{task.id}</span>
          {task.title !== null && <span className="card__task-title">{task.title}</span>}
        </p>
      )}

      {status.kind === 'running' && status.limitUntil !== null && <p className="card__wait">{limitWaitText(status.limitUntil, new Date())}</p>}
      {error !== null && <p className="card__error">{error}</p>}

      {canStart && (
        <footer className="card__foot">
          <button type="button" className="button button--primary" disabled={sending} onClick={() => void send('chain/start', { project })}>
            {state.chain.active === null ? t.project.start : t.project.enqueue}
          </button>
        </footer>
      )}
    </article>
  )
}
