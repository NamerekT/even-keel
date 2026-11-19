import type { ContextScale } from '../../../src/state.js'
import { formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { contextFill } from '../state.js'

interface ContextMeterProps {
  tokens: number
  window: number | null
  scale: ContextScale
  full?: boolean
  /** Only the percent, for the chain's row: the tokens are in its tip. */
  brief?: boolean
}

export function ContextMeter({ tokens, window, scale, full = false, brief = false }: ContextMeterProps) {
  const { percent, level } = contextFill(tokens, scale, window)
  if (window === null || percent === null) {
    return (
      <div className="context-meter">
        <span className="context-meter__track context-meter__track--unknown" aria-hidden="true" />
        <span className="context-meter__value">{formatTokens(tokens)}</span>
      </div>
    )
  }
  const value = full
    ? t.context.of(formatTokens(tokens), formatTokens(window), Math.round(percent))
    : brief
      ? `${Math.round(percent)}%`
      : `${Math.round(percent)}% · ${formatTokens(tokens)}`

  return (
    <div className={`context-meter context-meter--${level}`}>
      <span
        className="context-meter__track"
        role="meter"
        aria-label={t.context.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <span className="context-meter__fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="context-meter__value">{value}</span>
    </div>
  )
}
