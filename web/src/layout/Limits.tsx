import type { LimitWindow, RateLimits } from '../../../src/limits/model.js'
import { formatSpan } from '../format.js'

const HOT_PERCENT = 90

export function Limits({ limits, now }: { limits: RateLimits | null; now: Date }) {
  return (
    <div className="limits">
      <Meter label="5 ч" title="Лимит 5 часов" window={limits?.fiveHour ?? null} now={now} />
      <Meter label="Неделя" title="Недельный лимит" window={limits?.sevenDay ?? null} now={now} />
    </div>
  )
}

function Meter({ label, title, window, now }: { label: string; title: string; window: LimitWindow | null; now: Date }) {
  if (window === null) {
    return (
      <div className="meter meter--empty" title={`${title}: нет данных`}>
        <span className="meter__label">{label}</span>
        <span className="meter__bar" aria-hidden="true" />
        <span className="meter__value">—</span>
      </div>
    )
  }

  const percent = Math.round(Math.min(Math.max(window.usedPercentage, 0), 100))
  const resetIn = formatSpan(window.resetsAt, now)
  return (
    <div className={`meter${percent >= HOT_PERCENT ? ' meter--hot' : ''}`} title={`${title}: сброс через ${resetIn}`}>
      <span className="meter__label">{label}</span>
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
      <span className="meter__value">{percent}%</span>
      <span className="meter__reset">↻ {resetIn}</span>
    </div>
  )
}
