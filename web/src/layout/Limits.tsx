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

/**
 * A window's number: what is left of a counted allowance, what was spent of one of a known size (a ChatGPT seat's credits)
 * or of unknown size, else the share used. A narrow column gets what is left as the bare number, the share of a known size.
 */
export function windowValue(window: Pick<LimitWindow, 'left' | 'used' | 'limit'>, percent: number, short = false): string {
  if (window.left !== undefined) return short ? String(window.left) : t.limits.left(window.left)
  if (window.used !== undefined && window.limit !== undefined) return short ? `${percent}%` : t.limits.usedOf(Math.round(window.used), Math.round(window.limit))
  if (window.used !== undefined) return short ? t.limits.usedShort(window.used) : t.limits.used(window.used)
  return `${percent}%`
}

/** A window's count as a tip's caption and value ("Left 166", "Used 1250 of 5000"); `null` — a window of a share alone. */
export function windowFact(window: Pick<LimitWindow, 'left' | 'used' | 'limit'>): readonly [string, string] | null {
  if (window.left !== undefined) return [t.limits.facts.left, String(window.left)]
  if (window.used !== undefined && window.limit !== undefined) return [t.limits.facts.used, t.limits.usedOf(Math.round(window.used), Math.round(window.limit))]
  return window.used === undefined ? null : [t.limits.facts.used, String(window.used)]
}

/** A native `title` of facts: the first line as it is, every other a caption and its value a line. */
export function titleLines(head: string, rows: readonly (readonly [string, string] | null)[]): string {
  return [head, ...rows.filter((row) => row !== null).map(([caption, value]) => `${caption}: ${value}`)].join('\n')
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
  const source = limits === null ? null : t.limits.origins[limits.source]
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
  /** Where the reading came from, as the value of the tip's "Source"; `null` — no reading. */
  source: string | null
  window: LimitWindow | null
  now: Date
  bare: boolean
  named: boolean
}

function Meter({ label, title, source, window, now, bare, named }: MeterProps) {
  const sourceRow = source === null ? null : ([t.limits.facts.source, source] as const)
  if (window === null) {
    return (
      <div className="meter meter--empty" title={titleLines(t.limits.empty(title), [sourceRow])}>
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
    <div className={`meter${heat}`} title={titleLines(title, [[t.limits.facts.resets, resetIn], sourceRow])}>
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
