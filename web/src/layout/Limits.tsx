import type { LimitWindow, RateLimits } from '../../../src/limits/model.js'
import { formatSpan } from '../format.js'
import { t } from '../i18n/index.js'

const HOT_PERCENT = 90

export function Limits({ limits, now }: { limits: RateLimits | null; now: Date }) {
  const source = limits === null ? '' : ` · ${t.limits.sources[limits.source]}`
  return (
    <div className="limits">
      <Meter label={t.limits.fiveHour} title={t.limits.fiveHourTitle} source={source} window={limits?.fiveHour ?? null} now={now} />
      <Meter label={t.limits.week} title={t.limits.weekTitle} source={source} window={limits?.sevenDay ?? null} now={now} />
    </div>
  )
}

interface MeterProps {
  label: string
  title: string
  source: string
  window: LimitWindow | null
  now: Date
}

function Meter({ label, title, source, window, now }: MeterProps) {
  if (window === null) {
    return (
      <div className="meter meter--empty" title={t.limits.empty(title, source)}>
        <span className="meter__top">
          <span className="meter__label">{label}</span>
          <span className="meter__value">—</span>
        </span>
        <span className="meter__bar" aria-hidden="true" />
      </div>
    )
  }

  const percent = Math.round(Math.min(Math.max(window.usedPercentage, 0), 100))
  const resetIn = formatSpan(window.resetsAt, now)
  return (
    <div className={`meter${percent >= HOT_PERCENT ? ' meter--hot' : ''}`} title={t.limits.reset(title, resetIn, source)}>
      <span className="meter__top">
        <span className="meter__label">{label}</span>
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
