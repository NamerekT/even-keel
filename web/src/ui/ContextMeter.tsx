import type { ContextScale } from '../../../src/state.js'
import { formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { contextFill } from '../state.js'

/** `window` is the session's own context window; `null` — the setting's stands in. */
export function ContextMeter({ tokens, window, scale, full = false }: { tokens: number; window: number | null; scale: ContextScale; full?: boolean }) {
  const { percent, level } = contextFill(tokens, scale, window)
  const value = full
    ? t.context.of(formatTokens(tokens), formatTokens(window ?? scale.window), Math.round(percent))
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
