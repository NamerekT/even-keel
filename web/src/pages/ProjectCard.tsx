import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import {
  cardTask,
  chainProgress,
  chainStatus,
  ciWaitText,
  limitWaitText,
  openQuestions,
  projectPages,
  projectPath,
  projectSlot,
  projectTasks,
  projectTracker,
  questionPath,
  startsNow,
} from '../state.js'
import { StackIcon, TrackerIcon } from '../ui/icons.js'
import { Lamp } from '../ui/Lamp.js'
import { type EmptyCard, emptyCard, punchline } from '../ui/memes.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { ProjectLinks, Said } from '../ui/ProjectLinks.js'
import { QuestionsChip } from '../ui/QuestionsChip.js'
import { seriesStyle } from '../ui/series.js'
import { StatusChip } from '../ui/StatusChip.js'
import { Tipped } from '../ui/Tipped.js'
import { NoticeFixButton } from './FixButtons.js'
import { PullFixButton } from './PullButtons.js'

/** `turn` — which card of its empty kind this one is on the page (`emptyTurns`). */
export function ProjectCard({ state, project, turn }: { state: EvenKeelState; project: string; turn: number }) {
  const { send, sending, failure } = useCommand()

  const status = chainStatus(state.chain, project)
  const order = state.chain.projects[project]
  const { done, total, backlog } = chainProgress(projectTasks(state, project), order)
  const task = cardTask(state, project)
  const slot = projectSlot(state, project)
  const tracker = projectTracker(state, project)
  const canStart = status.kind === 'idle' && order !== undefined && order.error === null && order.order.length > 0
  const call = emptyCall(state, project)
  const pages = call === null ? [] : projectPages(state, project)
  const error = order?.error ?? (status.kind === 'paused' ? status.error : null) ?? failure

  return (
    <article className={`card card--${status.kind}`} style={seriesStyle(slot)}>
      <header className="card__head">
        <span className="card__swatch" aria-hidden="true" />
        <Link to={projectPath(project)} className="card__key">
          <ProjectLabel project={project} nameClass="card__name" />
        </Link>
        {(status.kind === 'paused' || status.kind === 'queued') && <StatusChip status={status} />}
        <QuestionsChip count={openQuestions(projectTasks(state, project))} to={questionPath(state, [project])} />
        {tracker !== null && (
          <Tipped className="card__tracker" tip={t.project.tracker(tracker.label)} inline focusable>
            <TrackerIcon kind={tracker.kind} />
          </Tipped>
        )}
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
          <>
            <EmptyLine progress={{ done, total, backlog }} turn={turn} />
            {call !== null && <p className="card__call">{call}</p>}
          </>
        )
      ) : (
        <p className="card__task">
          <Lamp lamp={task.lamp} />
          {task.next && <span className="card__task-label">{t.project.next}</span>}
          {task.held !== undefined && (
            <Tipped className="card__task-label card__task-label--held" tip={t.project.heldTip[task.held]} inline focusable>
              {t.project.held[task.held]}
            </Tipped>
          )}
          <span className="card__task-id">{task.id}</span>
          {task.title !== null && <TaskTitle title={task.title} />}
        </p>
      )}

      {status.kind === 'running' && status.limitUntil !== null && <p className="card__wait">{limitWaitText(status.limitUntil, new Date())}</p>}
      {status.kind === 'running' && status.slotWait !== undefined && (
        <p className="card__wait">
          <Said notice={{ ...status.slotWait, items: [] }} />
        </p>
      )}
      {status.kind === 'running' && status.ciWait !== undefined && (
        <p className="card__wait">
          <ProjectLinks text={ciWaitText(status.ciWait, new Date())} />
        </p>
      )}
      {error !== null && (
        <p className="card__error">
          <Said notice={error} />
        </p>
      )}
      <NoticeFixButton project={project} notice={error} />
      {status.kind === 'paused' && <PullFixButton state={state} project={project} error={status.error} />}

      {canStart && (
        <footer className="card__foot">
          <button type="button" className="button button--primary" disabled={sending} onClick={() => void send('chain/start', { project })}>
            {startsNow(state.chain) ? t.project.start : t.project.enqueue}
          </button>
        </footer>
      )}
      {pages.length > 0 && (
        <footer className="card__foot">
          {pages.map((page) => (
            <a key={page.url} className="button" href={page.url} target="_blank" rel="noreferrer">
              {t.project.openIn(page.tracker)}
            </a>
          ))}
        </footer>
      )}
    </article>
  )
}

/** The task's title in two lines; one cut short gives the whole of it in a tip. */
function TaskTitle({ title }: { title: string }) {
  const text = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const element = text.current
    if (element === null) return
    const measure = () => setCut(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [title])
  return (
    <Tipped className={cut ? 'card__task-title card__task-title--cut' : 'card__task-title'} tip={title} align="start" inline off={!cut}>
      <span ref={text} className="card__task-clamp">
        {title}
      </span>
    </Tipped>
  )
}

/** What the card says with no task to show; `null` — it shows a task or the chain is not read yet. */
export function emptyKind(state: EvenKeelState, project: string): EmptyCard | null {
  const order = state.chain.projects[project]
  if (order === undefined || cardTask(state, project) !== null) return null
  return emptyCard(chainProgress(projectTasks(state, project), order))
}

/** What to do about a project with nothing to run: file tasks or ready them in the tracker; `null` — it has tasks, held ones too. */
export function emptyCall(state: EvenKeelState, project: string): string | null {
  const kind = emptyKind(state, project)
  return kind === null || kind === 'held' ? null : t.project.emptyCall[kind]
}

/**
 * Stands still, so the cards do not type all at once: the setup, then the punchline of the card's `turn` among the cards
 * of its kind.
 */
function EmptyLine({ progress, turn }: { progress: Progress; turn: number }) {
  const quip = quipOf(progress, turn)
  if (quip === null) return <p className="card__task card__task--empty">{t.project.noTasks}</p>
  return (
    <p className="card__quip">
      {quip.setup}
      {quip.punchline !== null && <span className="card__punchline">{quip.punchline}</span>}
    </p>
  )
}

interface Progress {
  done: number
  total: number
  backlog: number
}

/** The joke of an empty card; `null` — its tasks are held, which is no joke. */
export function quipOf(progress: Progress, turn: number): { setup: string; punchline: string | null } | null {
  const kind = emptyCard(progress)
  if (kind === 'held') return null
  const { setup, punchlines } = t.project.emptyCard[kind]
  return { setup: setup(kind === 'shelved' ? progress.backlog : progress.done), punchline: punchline(punchlines, turn) }
}
