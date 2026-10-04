import type { ContextScale } from '../../../src/state.js'
import { formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { contextFill } from '../state.js'

export function ContextMeter({ tokens, scale, full = false }: { tokens: number; scale: ContextScale; full?: boolean }) {
  const { percent, level } = contextFill(tokens, scale)
  const value = full
    ? t.context.of(formatTokens(tokens), formatTokens(scale.window), Math.round(percent))
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
