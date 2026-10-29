import { Fold } from '../ui/Fold.js'
import type { TrackerUrls } from '../../../src/state.js'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { TALLY_DISABLED, TALLY_UNCHOSEN } from '../../../src/stats/mode.js'
import type { StatsAnswer } from '../../../src/stats/model.js'
import { t } from '../i18n/index.js'
import { activity } from '../live/activity.js'
import { openTab, SHARED_SCOPE } from '../pages/settingsStore.js'
import { stepPath } from '../pages/setupSteps.js'
import { issueLink } from '../state.js'
import { CardHead } from '../ui/blocks.js'
import { HelpTip } from '../pages/settingsParts.js'

const REFRESH_MS = 5 * 60_000

export type Loaded<T> = { key: string; answer: StatsAnswer<T> } | { key: string; failure: string }

export function useStatsAnswer<T>(key: string | null, load: () => Promise<StatsAnswer<T>>, refresh = true): Loaded<T> | null {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)

  useEffect(() => {
    if (key === null) return
    let alive = true
    const run = () =>
      load().then(
        (answer) => alive && setLoaded({ key, answer }),
        (reason: unknown) => alive && setLoaded({ key, failure: reason instanceof Error ? reason.message : String(reason) }),
      )
    void activity.track(run())
    const timer = refresh ? setInterval(() => void run(), REFRESH_MS) : undefined
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [key])

  return loaded
}

export function loadedData<T>(loaded: Loaded<T> | null): T | null {
  return loaded !== null && 'answer' in loaded && loaded.answer.state === 'ok' ? loaded.answer.data : null
}

/** Whether the answer on the page is not the one for `key` yet: nothing has come, or what is shown belongs to the previous filter. */
export function isStale(loaded: Loaded<unknown> | null, key: string | null): boolean {
  return loaded === null || loaded.key !== key
}

export type SkeletonShape = 'page' | 'tiles' | 'lines'

export function Skeleton({ shape }: { shape: SkeletonShape }) {
  return (
    <div className="skeleton" role="status" aria-label={t.stats.reading}>
      {shape !== 'lines' && (
        <div className="skeleton__row">
          {[0, 1, 2, 3].map((each) => (
            <span key={each} className="skeleton__block" />
          ))}
        </div>
      )}
      {shape === 'page' && <span className="skeleton__block skeleton__block--tall" />}
      {shape !== 'tiles' && [0, 1, 2].map((each) => <span key={each} className="skeleton__block skeleton__block--line" style={{ width: `${90 - each * 18}%` }} />)}
    </div>
  )
}

export function AnswerNotice({ loaded, shape = 'lines' }: { loaded: Loaded<unknown> | null; shape?: SkeletonShape }) {
  if (loaded === null) return <Skeleton shape={shape} />
  if ('failure' in loaded) return <p className="notice notice--error">{t.stats.failed(loaded.failure)}</p>
  if (loaded.answer.state === 'off') return <OffNotice reason={loaded.answer.reason} />
  if (loaded.answer.state === 'error') return <p className="notice notice--error">{t.stats.dbError(loaded.answer.error)}</p>
  if (loaded.answer.state === 'newer') return <p className="notice notice--error">{t.stats.newer(loaded.answer.version, loaded.answer.known)}</p>
  return null
}

/** Stats the user turned off or has not chosen are not an error: a plain note with the way to turn them on. */
function OffNotice({ reason }: { reason: string }) {
  if (reason === TALLY_DISABLED)
    return (
      <p className="notice">
        {t.stats.disabled}{' '}
        <Link to="/settings" onClick={() => openTab(SHARED_SCOPE, 'stats')}>
          {t.stats.disabledLink}
        </Link>
      </p>
    )
  if (reason === TALLY_UNCHOSEN)
    return (
      <p className="notice">
        {t.stats.unchosen} <Link to={stepPath('stats')}>{t.stats.unchosenLink}</Link>
      </p>
    )
  return <p className="notice notice--warn">{t.stats.off(reason)}</p>
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: [T, string, string?][]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([option, text, title]) => (
        <button
          key={option}
          type="button"
          title={title}
          className={option === value ? 'segmented__item segmented__item--on' : 'segmented__item'}
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** `url` — the link the launch log recorded, over the tracker's template. */
export function TaskKey({ id, trackerUrls, url = null }: { id: string; trackerUrls: TrackerUrls; url?: string | null }) {
  const link = url ?? issueLink(trackerUrls, id)
  return link === null ? (
    <span className="stats__key">{id}</span>
  ) : (
    <a className="stats__key" href={link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
      {id}
    </a>
  )
}

export interface FoldControl {
  open: boolean
  onToggle: (open: boolean) => void
}

/** With `fold` the head opens and folds the section, and a folded one does not render its content. `remark` is a joke scribbled on the head's margin. */
export function Section({
  title,
  help,
  aside,
  remark,
  fold,
  busy = false,
  children,
}: {
  title: string
  help?: string
  aside?: ReactNode
  remark?: string | null
  fold?: FoldControl
  busy?: boolean
  children: ReactNode
}) {
  const scribble = remark ? <span className="stats-remark">{remark}</span> : null
  if (fold === undefined) return (
    <section className="ui-card stats-section" aria-busy={busy}>
      <CardHead title={title}>{help && <HelpTip text={help} />}{aside}{scribble}</CardHead>
      <div className="stats-section__body">{children}</div>
    </section>
  )
  return (
    <section className={fold.open ? 'ui-card stats-section' : 'ui-card stats-section stats-section--folded'} aria-busy={busy}>
      <Fold open={fold.open} onOpenChange={fold.onToggle} summary={title} summaryClassName="stats-section__fold"
        header={(toggle) => <CardHead className="stats-section__head--fold" title={toggle} onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) fold.onToggle(!fold.open)
        }}>{help && <HelpTip text={help} />}{aside}{scribble}</CardHead>}
      >
        <div className="stats-section__body">{children}</div>
      </Fold>
    </section>
  )
}
