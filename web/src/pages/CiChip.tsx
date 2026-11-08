import { Fold } from '../ui/Fold.js'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { isOwnName } from '../../../src/chain/fix.js'
import type { FixEpisode } from '../../../src/chain/launches.js'
import {
  leadRun,
  pushesOf,
  pushStatus,
  runDurationMs,
  runLook,
  stuckSince,
  type BusyRunner,
  type CiJob,
  type CiRun,
  type CiView,
  type CurrentRun,
  type PushRuns,
  type RunLook,
  type WorkflowRun,
} from '../../../src/ci/model.js'
import type { TrackerUrls } from '../../../src/state.js'
import { ciLevel, countedViews, worstCiLevel } from '../ci.js'
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

const runsOf = (current: CurrentRun): CiRun[] => current.runs.map((each) => each.run)
const isDone = (look: RunLook) => look !== 'running' && look !== 'queued'

/** What started the runs, in words; `null` — no CI said. */
function eventsOf(runs: CiRun[]): string | null {
  const events = [...new Set(runs.flatMap((run) => (run.event === undefined ? [] : [run.event])))]
  return events.length === 0 ? null : events.map((event) => t.ci.events[event]).join(', ')
}

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
  const running = countedViews(views).flatMap((view) => (view.current === null ? [] : runsOf(view.current))).filter((run) => run.status === 'running')
  const clock = running.length === 0 ? null : Math.max(...running.map((run) => runDurationMs(run, now) ?? 0))
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
      {clock !== null && <span className="chip__extra"> · {formatClock(clock)}</span>}
    </button>
  )
}

interface Fixes {
  episodes: FixEpisode[]
  /** The commits of the fix the panel was opened on: their runs stand out. */
  marked: ReadonlySet<string>
}

/** The side panel with each CI's runs; a CI the project does not count goes after those it counts (BTN-828). */
export function CiPanel({ views, urls, fixes, fix, onClose }: { views: CiView[]; urls: TrackerUrls; fixes: FixEpisode[]; fix: string | null; onClose: () => void }) {
  const episode = fixes.find((each) => each.id === fix)
  const known: Fixes = { episodes: fixes, marked: new Set([episode?.red, episode?.end?.commit].filter((commit) => commit != null)) }
  const now = useNow(1_000)
  const closeRef = useRef<HTMLButtonElement>(null)
  const ordered = [...views.filter((view) => view.counted), ...views.filter((view) => !view.counted)]

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
      {ordered.map((view, index) => {
        const key = `${view.kind}-${view.remote}`
        return index > 0 && mirrors(view, ordered[0]!, now) ? (
          <CiMirror key={key} view={view} now={now} urls={urls} fixes={known} />
        ) : (
          <CiSection key={key} view={view} now={now} urls={urls} fixes={known} />
        )
      })}
    </aside>
  )
}

/** How many pushes the history shows before "Show all". */
const HISTORY_SHOWN = 5

/** A later CI that ran the first one's finished commit to the same end: its card would repeat the first (`docs/design.md`, "One fact once"). */
function mirrors(view: CiView, first: CiView, now: Date): boolean {
  const push = view.current
  const base = first.current
  if (push === null || base === null) return false
  const status = pushStatus(runsOf(push))
  return push.commit === base.commit && status === pushStatus(runsOf(base)) && isDone(status) && view.error === null && view.pushed === null && stuckSince(view, now) === null
}

const sectionClass = (view: CiView, now: Date, extra = '') => `ci ci--${ciLevel(view, now)}${view.counted ? '' : ' ci--uncounted'}${extra}`

function Lamp({ view, now }: { view: CiView; now: Date }) {
  return (
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
  )
}

/** A CI outside the project's `ci.kinds` judges nothing: it says so in its head. */
function Uncounted({ view }: { view: CiView }) {
  return view.counted ? null : (
    <span className="ci-status ci__uncounted" title={t.ci.uncountedTitle}>
      {t.ci.uncounted}
    </span>
  )
}

function AllRuns({ url }: { url: string }) {
  return (
    <a className="ci__all" href={url} target="_blank" rel="noreferrer" title={t.ci.allRuns} aria-label={t.ci.allRuns}>
      ↗
    </a>
  )
}

/** Each CI is a card: the verdict of its last push, its commit and tasks in view; workflows, jobs and history folded. */
function CiSection({ view, now, urls, fixes }: { view: CiView; now: Date; urls: TrackerUrls; fixes: Fixes }) {
  return (
    <section className={sectionClass(view, now)}>
      <header className="ci__head">
        <Lamp view={view} now={now} />
        <span className="ci__name">{t.ci.kinds[view.kind]}</span>
        <span className="ci__remote">{view.remote}</span>
        <Uncounted view={view} />
        <AllRuns url={view.url} />
      </header>
      <CiBody view={view} now={now} urls={urls} fixes={fixes} />
    </section>
  )
}

/** A mirror is one line — the dot, the name and "same commit · 3:12" — and opens into the whole card. */
function CiMirror({ view, now, urls, fixes }: { view: CiView; now: Date; urls: TrackerUrls; fixes: Fixes }) {
  const length = runDurationMs(leadRun(runsOf(view.current!), view.medians, now), now)
  return (
    <section className={sectionClass(view, now, ' ci--mirror')}>
      <Fold
        className="ci__mirror"
        summaryClassName="ci__mirror-toggle"
        header={(toggle) => (
          <header className="ci__head">
            <Lamp view={view} now={now} />
            {toggle}
            <AllRuns url={view.url} />
          </header>
        )}
        summary={
          <span className="ci__mirror-line">
            <span className="ci__name">{t.ci.kinds[view.kind]}</span>
            <span className="ci__remote">{view.remote}</span>
            <Uncounted view={view} />
            <span className="ci__same" title={t.ci.sameTitle}>
              {t.ci.same(formatClock(length ?? 0))}
            </span>
          </span>
        }
      >
        {() => <CiBody view={view} now={now} urls={urls} fixes={fixes} />}
      </Fold>
    </section>
  )
}

function CiBody({ view, now, urls, fixes }: { view: CiView; now: Date; urls: TrackerUrls; fixes: Fixes }) {
  const stuck = stuckSince(view, now)
  const queued = stuck !== null && view.current !== null && runsOf(view.current).some((run) => run.status === 'queued' && run.createdAt === stuck)
  return (
    <div className="ci__body">
      {view.error !== null && <p className={`notice ${view.health === 'off' ? 'notice--warn' : 'notice--error'} ci__notice`}>{say(view.error)}</p>}
      <NoticeFixButton project={null} notice={view.error} />
      {stuck !== null && (
        <p className="notice notice--warn ci__notice">
          {queued ? t.ci.stuckRun(formatAgoSpan(stuck, now)) : t.ci.stuckPush(short(view.pushed!.commit), formatAgoSpan(stuck, now))}
        </p>
      )}
      {stuck === null && view.pushed !== null && <p className="ci__hint">{t.ci.pushed(short(view.pushed.commit))}</p>}
      {view.current !== null && <Push current={view.current} medians={view.medians} busy={view.busy} now={now} urls={urls} fixes={fixes} />}
      {view.history.length > 0 ? (
        <History runs={view.history} medians={view.medians} now={now} marked={fixes.marked} />
      ) : (
        view.checkedAt !== null && view.health === 'ok' && <p className="ci__hint">{t.ci.noRuns}</p>
      )}
    </div>
  )
}

/** How long ago `at` was, as a span without "ago". */
function formatAgoSpan(at: string, now: Date): string {
  return formatSpan(new Date(2 * now.getTime() - Date.parse(at)).toISOString(), now)
}

/** "queued", or who holds the runner it waits for (BTN-828). */
function waitText(busy: BusyRunner | undefined): string {
  return busy === undefined ? t.ci.status.queued : t.ci.busy(busy.repository, busy.number)
}

/**
 * The push: its commit's title, commit, event, tasks, and the state and time of the run the verdict waits for longest.
 * A push of one workflow keeps that run's number and jobs in the block; one of several has a row per workflow (BTN-828).
 */
function Push({ current, medians, busy, now, urls, fixes }: { current: CurrentRun; medians: Record<string, number>; busy: BusyRunner | undefined; now: Date; urls: TrackerUrls; fixes: Fixes }) {
  const runs = runsOf(current)
  const lead = leadRun(runs, medians, now)
  const status = pushStatus(runs)
  const single = current.runs.length === 1 ? current.runs[0]! : null
  const fix = fixes.episodes.find((episode) => episode.end?.how === 'landed' && episode.end.commit === current.commit)
  const tasks = current.tasks.filter((task) => !isOwnName(task))
  const fixed = fix !== undefined || tasks.length < current.tasks.length
  const event = eventsOf(runs)
  return (
    <div className="ci__block">
      <a className={fixes.marked.has(current.commit) ? 'ci__run ci__run--fix' : 'ci__run'} href={lead.url} target="_blank" rel="noreferrer" title={t.ci.openRun}>
        {/* A finished push's colour is the head's dot already; only one still going says so in words. */}
        {(status === 'running' || status === 'queued') && (
          <span className={`ci-status ci-status--${status}`}>{status === 'queued' && single !== null ? waitText(busy) : t.ci.status[status]}</span>
        )}
        <span className="ci__title">{current.title}</span>
      </a>
      <div className="ci__meta">
        <span className="ci__seg ci__commit" title={current.commit}>
          {short(current.commit)}
        </span>
        {single !== null && <span className="ci__seg">#{single.run.number}</span>}
        {single !== null && !current.manual && <span className="ci__seg">{single.run.workflow}</span>}
        {event !== null && <span className="ci__seg">{event}</span>}
        <Timing run={lead} median={medians[lead.workflow] ?? null} now={now} meter={single !== null} />
      </div>
      {single !== null && status === 'notTaken' && <p className="ci__hint">{t.ci.notTaken}</p>}
      {(tasks.length > 0 || fixed) && (
        <p className="ci__tasks">
          <span className="ci__label">{t.ci.tasks}</span>
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
              <span key={task} className="ci__key">
                {task}
              </span>
            ) : (
              <a key={task} className="ci__key" href={href} target="_blank" rel="noreferrer">
                {task}
              </a>
            )
          })}
        </p>
      )}
      {single !== null ? <Jobs jobs={single.jobs} run={single.run} now={now} /> : <Workflows runs={current.runs} medians={medians} busy={busy} now={now} />}
    </div>
  )
}

/**
 * The run's time, apart from its commit: a meter against the usual length while it runs (`meter`, or the bare
 * "elapsed / usual"), the usual length while queued, the length and when once over.
 */
function Timing({ run, median, now, meter }: { run: CiRun; median: number | null; now: Date; meter: boolean }) {
  const length = runDurationMs(run, now) ?? 0
  if (run.status === 'queued') return median === null ? null : <span className="ci__when">{t.ci.usual(formatClock(median))}</span>
  if (run.status !== 'running') return <span className="ci__when">{`${t.ci.took(formatClock(length))} · ${formatAgo(run.stoppedAt ?? run.createdAt, now)}`}</span>
  if (median === null) return <span className="ci__when">{formatClock(length)}</span>
  const elapsed = `${formatClock(length)} / ${formatClock(median)}`
  if (!meter) return <span className={length > median ? 'ci__when ci__when--over' : 'ci__when'}>{elapsed}</span>
  return (
    <span className={length > median ? 'ci__when ci__progress ci__progress--over' : 'ci__when ci__progress'}>
      <span
        className="ci__track"
        role="meter"
        aria-label={t.ci.progress(formatClock(length), formatClock(median))}
        aria-valuemin={0}
        aria-valuemax={median}
        aria-valuenow={Math.min(length, median)}
      >
        <span className="ci__fill" style={{ width: `${Math.min(100, (length / median) * 100)}%` }} />
      </span>
      <span className="ci__elapsed">{elapsed}</span>
    </span>
  )
}

/** A row per workflow of the push: its dot, name, number and own time against its own usual length; its jobs fold under it. */
function Workflows({ runs, medians, busy, now }: { runs: WorkflowRun[]; medians: Record<string, number>; busy: BusyRunner | undefined; now: Date }) {
  return (
    <ul className="ci__workflows">
      {runs.map(({ run, jobs }) => {
        const line = <WorkflowLine run={run} median={medians[run.workflow] ?? null} busy={busy} now={now} />
        return (
          <li key={run.id} className="ci__job">
            {jobs.length === 0 ? (
              line
            ) : (
              <Fold defaultOpen={runLook(run) === 'failure'} summaryClassName="ci__job-summary" summary={line}>
                {() => <JobList jobs={jobs} run={run} now={now} />}
              </Fold>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function WorkflowLine({ run, median, busy, now }: { run: CiRun; median: number | null; busy: BusyRunner | undefined; now: Date }) {
  const look = runLook(run)
  return (
    <span className={`ci__workflow ci__line--${look}`}>
      <span className={`ci-status-dot ci-status-dot--${look}`} aria-label={t.ci.status[look]} role="img" />
      <span className="ci__line-name">{run.workflow}</span>
      <a className="ci__workflow-number" href={run.url} target="_blank" rel="noreferrer" title={t.ci.openRun}>
        #{run.number}
      </a>
      {look === 'notTaken' ? (
        <span className="ci__when">{t.ci.notTaken}</span>
      ) : run.status === 'queued' && busy !== undefined ? (
        <span className="ci__when" title={t.ci.busyTitle}>
          {waitText(busy)}
        </span>
      ) : (
        <Timing run={run} median={median} now={now} meter />
      )}
    </span>
  )
}

/** Folded unless the run is red, where what failed must be seen. */
function Jobs({ jobs, run, now }: { jobs: CiJob[]; run: CiRun; now: Date }) {
  if (jobs.length === 0) return <p className="ci__hint">{t.ci.noJobs}</p>
  return (
    <Fold
      className="ci__fold"
      defaultOpen={runLook(run) === 'failure'}
      summaryClassName="ci__summary"
      summary={
        <>
          {t.ci.jobs}
          <Dots looks={jobs.map((job) => job.status)} />
        </>
      }
    >
      {() => <JobList jobs={jobs} run={run} now={now} />}
    </Fold>
  )
}

/** A job's steps fold under it, open when it failed or is the only one; a job without steps from the API has a ↗ to the run page. */
function JobList({ jobs, run, now }: { jobs: CiJob[]; run: CiRun; now: Date }) {
  return (
    <ul className="ci__jobs">
      {jobs.map((job) => {
        const line = <Line status={job.status} name={job.name} length={lengthOf(job, now)} steps={job.steps === null ? run.url : undefined} />
        return (
          <li key={job.id} className="ci__job">
            {job.steps === null || job.steps.length === 0 ? (
              line
            ) : (
              <Fold defaultOpen={job.status === 'failure' || jobs.length === 1} summaryClassName="ci__job-summary" summary={line}>
                {() => (
                  <ul className="ci__steps">
                    {job.steps!.map((step, index) => (
                      <li key={index}>
                        <Line status={step.status} name={step.name} length={lengthOf(step, now)} />
                      </li>
                    ))}
                  </ul>
                )}
              </Fold>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** The states as a row of dots, so a folded section still shows what is red. */
function Dots({ looks }: { looks: RunLook[] }) {
  return (
    <span className="ci__dots">
      {looks.map((look, index) => (
        <span key={index} className={`ci-status-dot ci-status-dot--${look}`} aria-label={t.ci.status[look]} role="img" />
      ))}
    </span>
  )
}

function lengthOf(item: Pick<CiJob, 'startedAt' | 'stoppedAt'>, now: Date): number | null {
  if (item.startedAt === null) return null
  return Math.max(0, (item.stoppedAt === null ? now.getTime() : Date.parse(item.stoppedAt)) - Date.parse(item.startedAt))
}

/** `steps` is the run page, for a job whose steps the API does not give. */
function Line({ status, name, length, steps }: { status: CiRun['status']; name: string; length: number | null; steps?: string }) {
  return (
    <span className={`ci__line ci__line--${status}`} title={t.ci.status[status]}>
      <span className={`ci-status-dot ci-status-dot--${status}`} aria-label={t.ci.status[status]} role="img" />
      <span className="ci__line-name">{name}</span>
      <span className="ci__line-time">{length === null ? '' : formatClock(length)}</span>
      {steps !== undefined && (
        <a className="ci__open" href={steps} target="_blank" rel="noreferrer" title={t.ci.stepsOnPage} aria-label={t.ci.stepsOnPage}>
          ↗
        </a>
      )}
    </span>
  )
}

/** A row per push, folded to the last pushes as dots; open on the fix the panel was opened on, with every push when its one is past the first ones. */
function History({ runs, medians, now, marked }: { runs: CiRun[]; medians: Record<string, number>; now: Date; marked: ReadonlySet<string> }) {
  const [more, setMore] = useState(false)
  const pushes = pushesOf(runs)
  const markedAt = pushes.findIndex((push) => marked.has(push.commit))
  const all = more || markedAt >= HISTORY_SHOWN || pushes.length <= HISTORY_SHOWN
  return (
    <Fold
      className="ci__fold"
      defaultOpen={markedAt >= 0}
      summaryClassName="ci__summary"
      summary={
        <>
          {t.ci.history}
          <Dots looks={pushes.slice(0, HISTORY_SHOWN).map((push) => pushStatus(push.runs))} />
        </>
      }
    >
      {() => (
        <>
          <ul className="ci__history">
            {(all ? pushes : pushes.slice(0, HISTORY_SHOWN)).map((push) => (
              <PushRow key={push.key} push={push} medians={medians} now={now} marked={marked.has(push.commit)} />
            ))}
          </ul>
          {!all && (
            <button type="button" className="ci__more" onClick={() => setMore(true)}>
              {t.ci.showAll(pushes.length)}
            </button>
          )}
        </>
      )}
    </Fold>
  )
}

/** The push's state, commit, title, a dot per workflow when there are several, its time and when; the event and run numbers are its tip. */
function PushRow({ push, medians, now, marked }: { push: PushRuns; medians: Record<string, number>; now: Date; marked: boolean }) {
  const look = pushStatus(push.runs)
  const lead = leadRun(push.runs, medians, now)
  const length = runDurationMs(lead, now)
  const tip = [t.ci.status[look], eventsOf(push.runs), push.runs.map((run) => `${run.workflow} #${run.number}`).join(', ')].filter((part) => part !== null).join(' · ')
  return (
    <li>
      <a className={marked ? 'ci__past ci__past--fix' : 'ci__past'} href={lead.url} target="_blank" rel="noreferrer" title={tip}>
        <span className={`ci-status-dot ci-status-dot--${look}`} aria-label={t.ci.status[look]} role="img" />
        <span className="ci__past-commit">{short(push.commit)}</span>
        <span className="ci__past-title">{push.title}</span>
        <span className="ci__dots">
          {push.runs.length > 1 &&
            push.runs.map((run) => (
              <span
                key={run.id}
                className={`ci-status-dot ci-status-dot--${runLook(run)}`}
                title={t.ci.workflow(run.workflow, t.ci.status[runLook(run)])}
                aria-label={t.ci.workflow(run.workflow, t.ci.status[runLook(run)])}
                role="img"
              />
            ))}
        </span>
        <span className="ci__line-time">{length === null ? '' : formatClock(length)}</span>
        <span className="ci__past-ago">{formatAgo(push.runs.at(-1)!.createdAt, now)}</span>
      </a>
    </li>
  )
}
