import { useEffect, useRef } from 'react'
import { isFinished, runDurationMs, stuckSince, type CiJob, type CiRun, type CiView, type CurrentRun } from '../../../src/ci/model.js'
import type { TrackerUrls } from '../../../src/state.js'
import { ciLevel, worstCiLevel } from '../ci.js'
import { formatAgo, formatClock, formatSpan } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { issueLink } from '../state.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import './ci.css'

const SHORT_SHA = 7
const short = (commit: string) => commit.slice(0, SHORT_SHA)

/** The address hash that opens the CI panel; a task id never equals it. */
export const CI_HASH = 'ci'

const CI_CLASS: Record<ChipLook, string> = { tag: 'chip chip--ci', tab: 'side-tab', seg: SEG_CLASS }

/** The CI badge: a chip in the project head, a tab on the side column's card or a segment of the narrow head. It opens the CI panel. */
export function CiChip({ views, open, look = 'tag', onToggle }: { views: CiView[]; open: boolean; look?: ChipLook; onToggle: () => void }) {
  const now = useNow(1_000)
  const level = worstCiLevel(views, now)
  const running = views.map((view) => view.current?.run).find((run) => run?.status === 'running')
  const label = t.ci.title(t.ci.levels[level])

  return (
    <button
      type="button"
      className={`${CI_CLASS[look]} chip--ci-${level}`}
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <span className="ci-dot" aria-hidden="true" />
      {t.ci.chip}
      {running !== undefined && <span className="chip__extra"> · {formatClock(runDurationMs(running, now) ?? 0)}</span>}
    </button>
  )
}

/** The side panel with each CI's runs. */
export function CiPanel({ views, urls, onClose }: { views: CiView[]; urls: TrackerUrls; onClose: () => void }) {
  const now = useNow(1_000)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.querySelector('dialog[open]') === null) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <aside className="panel ci-card" aria-label={t.ci.panel}>
      <header className="panel__head">
        <h2 className="panel__task">{t.ci.panel}</h2>
        <button ref={closeRef} type="button" className="panel__close" aria-label={t.session.closePanel} onClick={onClose}>
          ×
        </button>
      </header>
      {views.map((view) => (
        <CiSection key={`${view.kind}-${view.remote}`} view={view} now={now} urls={urls} />
      ))}
    </aside>
  )
}

function CiSection({ view, now, urls }: { view: CiView; now: Date; urls: TrackerUrls }) {
  const stuck = stuckSince(view, now)
  const queued = view.current?.run.status === 'queued' && stuck === view.current.run.createdAt
  return (
    <section className={`ci ci--${ciLevel(view, now)}`}>
      <header className="ci__head">
        <span className="ci-dot" aria-hidden="true" />
        <span className="ci__name">{t.ci.kinds[view.kind]}</span>
        <span className="ci__remote">{view.remote}</span>
        <a className="ci__all" href={view.url} target="_blank" rel="noreferrer">
          {t.ci.allRuns}
        </a>
      </header>
      <p className="ci__health">
        {t.ci.api[view.health]}
        {view.checkedAt !== null && ` · ${t.ci.checked(formatAgo(view.checkedAt, now))}`}
      </p>
      {view.error !== null && <p className={`notice ${view.health === 'off' ? 'notice--warn' : 'notice--error'} ci__notice`}>{say(view.error)}</p>}
      {stuck !== null && (
        <p className="notice notice--warn ci__notice">
          {queued ? t.ci.stuckRun(formatAgoSpan(stuck, now)) : t.ci.stuckPush(short(view.pushed!.commit), formatAgoSpan(stuck, now))}
        </p>
      )}
      {stuck === null && view.pushed !== null && <p className="ci__hint">{t.ci.pushed(short(view.pushed.commit))}</p>}
      {view.current !== null && <Current current={view.current} median={view.medianMs} now={now} urls={urls} />}
      {view.history.length > 0 ? <History runs={view.history} now={now} /> : view.checkedAt !== null && view.health === 'ok' && <p className="ci__hint">{t.ci.noRuns}</p>}
    </section>
  )
}

/** How long ago `at` was, as a span without "ago". */
function formatAgoSpan(at: string, now: Date): string {
  return formatSpan(new Date(2 * now.getTime() - Date.parse(at)).toISOString(), now)
}

function Current({ current, median, now, urls }: { current: CurrentRun; median: number | null; now: Date; urls: TrackerUrls }) {
  const { run, tasks, jobs } = current
  const finished = isFinished(run.status)
  return (
    <div className="ci__block">
      <h3 className="ci__heading">{finished ? t.ci.last : t.ci.current}</h3>
      <a className="ci__run" href={run.url} target="_blank" rel="noreferrer" title={t.ci.openRun}>
        <span className={`ci-status ci-status--${run.status}`}>{t.ci.status[run.status]}</span>
        <span className="ci__title">{run.title}</span>
      </a>
      <p className="ci__meta">
        <code>{short(run.commit)}</code> · #{run.number} · {run.workflow}
        {timing(run, median, now)}
      </p>
      {tasks.length > 0 && (
        <p className="ci__tasks">
          <span className="ci__label">{t.ci.tasks}:</span>
          {tasks.map((task) => {
            const href = issueLink(urls, task)
            return href === null ? (
              <code key={task}>{task}</code>
            ) : (
              <a key={task} href={href} target="_blank" rel="noreferrer">
                <code>{task}</code>
              </a>
            )
          })}
        </p>
      )}
      <Jobs jobs={jobs} run={run} now={now} />
    </div>
  )
}

function timing(run: CiRun, median: number | null, now: Date): string {
  const length = runDurationMs(run, now)
  const usual = median === null ? '' : `, ${t.ci.usual(formatClock(median))}`
  if (run.status === 'queued') return median === null ? '' : ` · ${t.ci.usual(formatClock(median))}`
  if (run.status === 'running') return ` · ${t.ci.running(formatClock(length ?? 0))}${usual}`
  return ` · ${t.ci.took(formatClock(length ?? 0))} · ${formatAgo(run.stoppedAt ?? run.createdAt, now)}`
}

function Jobs({ jobs, run, now }: { jobs: CiJob[]; run: CiRun; now: Date }) {
  if (jobs.length === 0) return <p className="ci__hint">{t.ci.noJobs}</p>
  const noSteps = jobs.some((job) => job.steps === null)
  return (
    <>
      <h3 className="ci__heading">{t.ci.jobs}</h3>
      <ul className="ci__jobs">
        {jobs.map((job) => (
          <li key={job.id} className="ci__job">
            <Line status={job.status} name={job.name} length={lengthOf(job, now)} />
            {job.steps !== null && job.steps.length > 0 && (
              <ul className="ci__steps">
                {job.steps.map((step, index) => (
                  <li key={index}>
                    <Line status={step.status} name={step.name} length={lengthOf(step, now)} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {noSteps && (
        <a className="ci__hint ci__steps-link" href={run.url} target="_blank" rel="noreferrer">
          {t.ci.stepsOnPage}
        </a>
      )}
    </>
  )
}

function lengthOf(item: Pick<CiJob, 'startedAt' | 'stoppedAt'>, now: Date): number | null {
  if (item.startedAt === null) return null
  return Math.max(0, (item.stoppedAt === null ? now.getTime() : Date.parse(item.stoppedAt)) - Date.parse(item.startedAt))
}

function Line({ status, name, length }: { status: CiRun['status']; name: string; length: number | null }) {
  return (
    <span className={`ci__line ci__line--${status}`} title={t.ci.status[status]}>
      <span className={`ci-status-dot ci-status-dot--${status}`} aria-label={t.ci.status[status]} role="img" />
      <span className="ci__line-name">{name}</span>
      <span className="ci__line-time">{length === null ? '' : formatClock(length)}</span>
    </span>
  )
}

function History({ runs, now }: { runs: CiRun[]; now: Date }) {
  return (
    <>
      <h3 className="ci__heading">{t.ci.history}</h3>
      <ul className="ci__history">
        {runs.map((run) => {
          const length = runDurationMs(run, now)
          return (
            <li key={run.id}>
              <a className="ci__past" href={run.url} target="_blank" rel="noreferrer" title={`${t.ci.status[run.status]} · ${run.title}`}>
                <span className={`ci-status-dot ci-status-dot--${run.status}`} aria-label={t.ci.status[run.status]} role="img" />
                <span className="ci__past-number">#{run.number}</span>
                <code className="ci__past-commit">{short(run.commit)}</code>
                <span className="ci__past-title">{run.title}</span>
                <span className="ci__line-time">{length === null ? '' : formatClock(length)}</span>
                <span className="ci__past-ago">{formatAgo(run.createdAt, now)}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </>
  )
}
