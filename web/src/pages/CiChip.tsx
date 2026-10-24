import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { isOwnName } from '../../../src/chain/fix.js'
import type { FixEpisode } from '../../../src/chain/launches.js'
import { runDurationMs, stuckSince, type CiJob, type CiRun, type CiView, type CurrentRun } from '../../../src/ci/model.js'
import type { TrackerUrls } from '../../../src/state.js'
import { ciLevel, worstCiLevel } from '../ci.js'
import { formatAgo, formatClock, formatSpan } from '../format.js'
import { say, t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { issueLink } from '../state.js'
import { Tipped } from '../ui/Tipped.js'
import { SEG_CLASS, type ChipLook } from './chipLook.js'
import { NoticeFixButton } from './FixButtons.js'
import './ci.css'

const SHORT_SHA = 7
const short = (commit: string) => commit.slice(0, SHORT_SHA)

/** The address hash that opens the CI panel; a task id never equals it. */
export const CI_HASH = 'ci'

/** The hash that opens the CI panel on the runs of a fix of main that is over (BTN-153). */
export const ciHash = (fix: string) => `${CI_HASH}/${fix}`

/** Whether the hash opens the CI panel, and on which fix if on one. */
export function ciFocus(hash: string): { open: boolean; fix: string | null } {
  if (hash === CI_HASH) return { open: true, fix: null }
  return hash.startsWith(`${CI_HASH}/`) ? { open: true, fix: hash.slice(CI_HASH.length + 1) } : { open: false, fix: null }
}

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

interface Fixes {
  episodes: FixEpisode[]
  /** The commits of the fix the panel was opened on: their runs stand out. */
  marked: ReadonlySet<string>
}

/** The side panel with each CI's runs. */
export function CiPanel({ views, urls, fixes, fix, onClose }: { views: CiView[]; urls: TrackerUrls; fixes: FixEpisode[]; fix: string | null; onClose: () => void }) {
  const episode = fixes.find((each) => each.id === fix)
  const known: Fixes = { episodes: fixes, marked: new Set([episode?.red, episode?.end?.commit].filter((commit) => commit != null)) }
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
        <CiSection key={`${view.kind}-${view.remote}`} view={view} now={now} urls={urls} fixes={known} />
      ))}
    </aside>
  )
}

/** How many runs the history shows before "Show all". */
const HISTORY_SHOWN = 5

/** Each CI is a card: the verdict of its last run, its commit and tasks in view; jobs, steps and history folded. */
function CiSection({ view, now, urls, fixes }: { view: CiView; now: Date; urls: TrackerUrls; fixes: Fixes }) {
  const stuck = stuckSince(view, now)
  const queued = view.current?.run.status === 'queued' && stuck === view.current.run.createdAt
  return (
    <section className={`ci ci--${ciLevel(view, now)}`}>
      <header className="ci__head">
        <Tipped
          className="ci__lamp"
          inline
          focusable
          align="start"
          tip={
            <>
              <span>{t.ci.api[view.health]}</span>
              {view.checkedAt !== null && <span>{t.ci.checked(formatAgo(view.checkedAt, now))}</span>}
            </>
          }
        >
          <span className="ci-dot" aria-hidden="true" />
        </Tipped>
        <span className="ci__name">{t.ci.kinds[view.kind]}</span>
        <span className="ci__remote">{view.remote}</span>
        <a className="ci__all" href={view.url} target="_blank" rel="noreferrer">
          {t.ci.allRuns}
        </a>
      </header>
      {view.error !== null && <p className={`notice ${view.health === 'off' ? 'notice--warn' : 'notice--error'} ci__notice`}>{say(view.error)}</p>}
      <NoticeFixButton project={null} notice={view.error} />
      {stuck !== null && (
        <p className="notice notice--warn ci__notice">
          {queued ? t.ci.stuckRun(formatAgoSpan(stuck, now)) : t.ci.stuckPush(short(view.pushed!.commit), formatAgoSpan(stuck, now))}
        </p>
      )}
      {stuck === null && view.pushed !== null && <p className="ci__hint">{t.ci.pushed(short(view.pushed.commit))}</p>}
      {view.current !== null && <Current current={view.current} median={view.medianMs} now={now} urls={urls} fixes={fixes} />}
      {view.history.length > 0 ? <History runs={view.history} now={now} marked={fixes.marked} /> : view.checkedAt !== null && view.health === 'ok' && <p className="ci__hint">{t.ci.noRuns}</p>}
    </section>
  )
}

/** How long ago `at` was, as a span without "ago". */
function formatAgoSpan(at: string, now: Date): string {
  return formatSpan(new Date(2 * now.getTime() - Date.parse(at)).toISOString(), now)
}

function Current({ current, median, now, urls, fixes }: { current: CurrentRun; median: number | null; now: Date; urls: TrackerUrls; fixes: Fixes }) {
  const { run, jobs } = current
  const fix = fixes.episodes.find((episode) => episode.end?.how === 'landed' && episode.end.commit === run.commit)
  const tasks = current.tasks.filter((task) => !isOwnName(task))
  const fixed = fix !== undefined || tasks.length < current.tasks.length
  return (
    <div className="ci__block">
      <a className={fixes.marked.has(run.commit) ? 'ci__run ci__run--fix' : 'ci__run'} href={run.url} target="_blank" rel="noreferrer" title={t.ci.openRun}>
        {/* A finished run's colour is the head's dot already; only a run still going says so in words. */}
        {(run.status === 'running' || run.status === 'queued') && <span className={`ci-status ci-status--${run.status}`}>{t.ci.status[run.status]}</span>}
        <span className="ci__title">{run.title}</span>
      </a>
      <p className="ci__meta">
        <code>{short(run.commit)}</code> · #{run.number} · {run.workflow}
        {timing(run, median, now)}
      </p>
      {(tasks.length > 0 || fixed) && (
        <p className="ci__tasks">
          <span className="ci__label">{t.ci.tasks}:</span>
          {fixed &&
            (fix === undefined ? (
              <span className="ci__fix">{t.ci.fixTask}</span>
            ) : (
              <Link className="ci__fix" to={{ hash: fix.id }} title={t.ci.fixTaskTitle}>
                {t.ci.fixTask}
              </Link>
            ))}
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

/** Folded unless the run is red, where what failed must be seen; a job's steps fold under it, open when it failed or is the only one. */
function Jobs({ jobs, run, now }: { jobs: CiJob[]; run: CiRun; now: Date }) {
  if (jobs.length === 0) return <p className="ci__hint">{t.ci.noJobs}</p>
  const noSteps = jobs.some((job) => job.steps === null)
  return (
    <details className="ci__fold" open={run.status === 'failure'}>
      <summary className="ci__summary">
        <Chevron />
        {t.ci.jobs}
        <Dots statuses={jobs.map((job) => job.status)} />
      </summary>
      <ul className="ci__jobs">
        {jobs.map((job) => {
          const line = <Line status={job.status} name={job.name} length={lengthOf(job, now)} />
          return (
            <li key={job.id} className="ci__job">
              {job.steps === null || job.steps.length === 0 ? (
                line
              ) : (
                <details open={job.status === 'failure' || jobs.length === 1}>
                  <summary className="ci__job-summary">
                    <Chevron />
                    {line}
                  </summary>
                  <ul className="ci__steps">
                    {job.steps.map((step, index) => (
                      <li key={index}>
                        <Line status={step.status} name={step.name} length={lengthOf(step, now)} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          )
        })}
      </ul>
      {noSteps && (
        <a className="ci__hint ci__steps-link" href={run.url} target="_blank" rel="noreferrer">
          {t.ci.stepsOnPage}
        </a>
      )}
    </details>
  )
}

function Chevron() {
  return (
    <span className="ci__chevron" aria-hidden="true">
      ›
    </span>
  )
}

/** The statuses as a row of dots, so a folded section still shows what is red. */
function Dots({ statuses }: { statuses: CiRun['status'][] }) {
  return (
    <span className="ci__dots">
      {statuses.map((status, index) => (
        <span key={index} className={`ci-status-dot ci-status-dot--${status}`} aria-label={t.ci.status[status]} role="img" />
      ))}
    </span>
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

/** Folded, the last runs shown as dots; open on the fix the panel was opened on, with every run when its run is past the first ones. */
function History({ runs, now, marked }: { runs: CiRun[]; now: Date; marked: ReadonlySet<string> }) {
  const [more, setMore] = useState(false)
  const markedAt = runs.findIndex((run) => marked.has(run.commit))
  const all = more || markedAt >= HISTORY_SHOWN || runs.length <= HISTORY_SHOWN
  return (
    <details className="ci__fold" open={markedAt >= 0}>
      <summary className="ci__summary">
        <Chevron />
        {t.ci.history}
        <Dots statuses={runs.slice(0, HISTORY_SHOWN).map((run) => run.status)} />
      </summary>
      <ul className="ci__history">
        {(all ? runs : runs.slice(0, HISTORY_SHOWN)).map((run) => {
          const length = runDurationMs(run, now)
          return (
            <li key={run.id}>
              <a className={marked.has(run.commit) ? 'ci__past ci__past--fix' : 'ci__past'} href={run.url} target="_blank" rel="noreferrer" title={`${t.ci.status[run.status]} · ${run.title}`}>
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
      {!all && (
        <button type="button" className="ci__more" onClick={() => setMore(true)}>
          {t.ci.showAll(runs.length)}
        </button>
      )}
    </details>
  )
}
