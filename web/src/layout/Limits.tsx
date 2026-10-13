import type { LimitWindow, RateLimits } from '../../../src/limits/model.js'
import { formatSpan } from '../format.js'
import { t } from '../i18n/index.js'

export const WARM_PERCENT = 80
export const FULL_PERCENT = 100

interface LimitsProps {
  limits: RateLimits | null
  now: Date
  bare?: boolean
}

export function Limits({ limits, now, bare = false }: LimitsProps) {
  const source = limits === null ? '' : ` · ${t.limits.sources[limits.source]}`
  return (
    <div className={bare ? 'limits limits--bare' : 'limits'}>
      <Meter label={t.limits.fiveHour} title={t.limits.fiveHourTitle} source={source} window={limits?.fiveHour ?? null} now={now} bare={bare} />
      <Meter label={t.limits.week} title={t.limits.weekTitle} source={source} window={limits?.sevenDay ?? null} now={now} bare={bare} />
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
}

function Meter({ label, title, source, window, now, bare }: MeterProps) {
  if (window === null) {
    return (
      <div className="meter meter--empty" title={t.limits.empty(title, source)}>
        <span className="meter__top">
          {!bare && <span className="meter__label">{label}</span>}
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
        {!bare && <span className="meter__label">{label}</span>}
        <span className="meter__value">{percent}%</span>
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
