import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { cardTask, chainProgress, chainStatus, limitWaitText, openQuestions, projectSlot, projectTasks, startsNow } from '../state.js'
import { StackIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { emptyCard } from '../ui/memes.js'
import { Typed } from '../ui/Typed.js'
import { QuestionsChip } from '../ui/QuestionsChip.js'
import { seriesStyle } from '../ui/series.js'
import { StatusChip } from '../ui/StatusChip.js'

export function ProjectCard({ state, project }: { state: EvenKeelState; project: string }) {
  const { send, sending, failure } = useCommand()

  const status = chainStatus(state.chain, project)
  const order = state.chain.projects[project]
  const { done, total, backlog } = chainProgress(projectTasks(state, project), order)
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
        {(status.kind === 'paused' || status.kind === 'queued') && <StatusChip status={status} />}
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
          {backlog > 0 && (
            <span className="card__backlog" role="img" aria-label={t.project.backlog(backlog)} title={`${t.project.backlog(backlog)}. ${t.project.backlogHint}`}>
              <StackIcon />
              {backlog}
            </span>
          )}
        </span>
      </div>

      {task === null ? (
        order === undefined ? (
          <p className="card__task card__task--empty">{t.project.notLoaded}</p>
        ) : (
          <EmptyLine progress={{ done, total, backlog }} />
        )
      ) : (
        <p className="card__task">
          <Lamp lamp={task.lamp} />
          {task.next && <span className="card__task-label">{t.project.next}</span>}
          <span className="card__task-id">{task.id}</span>
          {task.title !== null && <span className="card__task-title">{task.title}</span>}
        </p>
      )}

      {status.kind === 'running' && status.limitUntil !== null && <p className="card__wait">{limitWaitText(status.limitUntil, new Date())}</p>}
      {status.kind === 'running' && status.slotWait !== undefined && <p className="card__wait">{say({ ...status.slotWait, items: [] })}</p>}
      {error !== null && <p className="card__error">{say(error)}</p>}

      {canStart && (
        <footer className="card__foot">
          <button type="button" className="button button--primary" disabled={sending} onClick={() => void send('chain/start', { project })}>
            {startsNow(state.chain) ? t.project.start : t.project.enqueue}
          </button>
        </footer>
      )}
    </article>
  )
}

const CARD_PACE = { charMs: 35, pauseMs: 1500 }

function EmptyLine({ progress }: { progress: { done: number; total: number; backlog: number } }) {
  const kind = emptyCard(progress)
  if (kind === 'held') return <p className="card__task card__task--empty">{t.project.noTasks}</p>
  const lines = t.project.emptyCard
  const parts = kind === 'shelved' ? lines.shelved(progress.backlog) : kind === 'ghost' ? lines.ghost : lines.finished(progress.done)
  return <Typed key={kind} parts={parts} pace={CARD_PACE} className="card__task card__task--empty" />
}
