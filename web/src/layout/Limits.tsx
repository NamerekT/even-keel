import type { LimitWindow, RateLimits } from '../../../src/limits/model.js'
import { formatSpan } from '../format.js'

const HOT_PERCENT = 90

const SOURCES: Record<RateLimits['source'], string> = { usage: 'по /usage', statusline: 'по statusline' }

export function Limits({ limits, now }: { limits: RateLimits | null; now: Date }) {
  const source = limits === null ? '' : ` · ${SOURCES[limits.source]}`
  return (
    <div className="limits">
      <Meter label="5 часов" title="Лимит 5 часов" source={source} window={limits?.fiveHour ?? null} now={now} />
      <Meter label="Неделя" title="Недельный лимит" source={source} window={limits?.sevenDay ?? null} now={now} />
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
      <div className="meter meter--empty" title={`${title}: нет данных${source}`}>
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
    <div className={`meter${percent >= HOT_PERCENT ? ' meter--hot' : ''}`} title={`${title}: сброс через ${resetIn}${source}`}>
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
