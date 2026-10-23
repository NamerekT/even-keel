import { limitSpans, type LimitSpan, type LimitWindow, type RateLimits } from '../../../src/limits/model.js'
import { formatSpan } from '../format.js'
import { t } from '../i18n/index.js'

export const WARM_PERCENT = 80
export const FULL_PERCENT = 100

/** The short name of a window and its full one. */
export function spanNames(span: LimitSpan): { label: string; title: string } {
  if (span === 'fiveHour') return { label: t.limits.fiveHour, title: t.limits.fiveHourTitle }
  if (span === 'sevenDay') return { label: t.limits.week, title: t.limits.weekTitle }
  return { label: t.limits.month, title: t.limits.monthTitle }
}

/** Whether the account has the five-hour and the weekly window, the ones a list's shared column heads name. */
export function usualSpans(limits: RateLimits | null | undefined): boolean {
  return limitSpans(limits).join() === 'fiveHour,sevenDay'
}

/** A window's number: what is left of a counted allowance, what was spent of one of unknown size, else the share used. */
export function windowValue(window: LimitWindow, percent: number): string {
  if (window.left !== undefined) return t.limits.left(window.left)
  return window.used !== undefined ? t.limits.used(window.used) : `${percent}%`
}

interface LimitsProps {
  limits: RateLimits | null
  now: Date
  /** Without the window names, for meters under column heads. */
  bare?: boolean
  /** Names the windows even when bare: the heads above are a list's shared ones and name other windows. */
  named?: boolean
}

export function Limits({ limits, now, bare = false, named = false }: LimitsProps) {
  const source = limits === null ? '' : ` · ${t.limits.sources[limits.source]}`
  return (
    <div className={bare ? 'limits limits--bare' : 'limits'}>
      {limitSpans(limits).map((span) => (
        <Meter key={span} {...spanNames(span)} source={source} window={limits?.[span] ?? null} now={now} bare={bare} named={!bare || named} />
      ))}
    </div>
  )
}

interface MeterProps {
  label: string
  title: string
  source: string
  window: LimitWindow | null
  now: Date
  bare: boolean
  named: boolean
}

function Meter({ label, title, source, window, now, bare, named }: MeterProps) {
  if (window === null) {
    return (
      <div className="meter meter--empty" title={t.limits.empty(title, source)}>
        <span className="meter__top">
          {named && <span className="meter__label">{label}</span>}
          <span className="meter__value">{bare ? t.limits.noData : '—'}</span>
        </span>
        <span className="meter__bar" aria-hidden="true" />
      </div>
    )
  }

  const percent = Math.round(Math.min(Math.max(window.usedPercentage, 0), 100))
  const resetIn = formatSpan(window.resetsAt, now)
  const heat = percent >= FULL_PERCENT ? ' meter--full' : percent >= WARM_PERCENT ? ' meter--warm' : ''
  return (
    <div className={`meter${heat}`} title={t.limits.reset(title, resetIn, source)}>
      <span className="meter__top">
        {named && <span className="meter__label">{label}</span>}
        <span className="meter__value">{windowValue(window, percent)}</span>
        <span className="meter__reset">↻ {resetIn}</span>
      </span>
      <span
        className="meter__bar"
        role="meter"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="meter__fill" style={{ width: `${percent}%` }} />
      </span>
    </div>
  )
}
