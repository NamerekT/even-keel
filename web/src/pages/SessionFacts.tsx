import type { ReactNode } from 'react'
import { CLAUDE } from '../../../src/claude/name.js'
import type { CacheWindow, TokenTotals } from '../../../src/sessions/transcript.js'
import type { ContextScale } from '../../../src/state.js'
import { agentLabel } from '../accountName.js'
import { formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { contextFill, tokenTotal } from '../state.js'
import { Fact } from '../ui/blocks.js'
import { CacheClock } from '../ui/CacheClock.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { modelName } from '../ui/runLabel.js'
import { useTip } from '../ui/useTip.js'

export function CacheFact({ cache }: { cache: CacheWindow }) {
  return (
    <TipValue value={<CacheClock cache={cache} bare />}>
      <span className="panel__part">
        <span className="panel__part-label">{t.session.lifetime}</span>
        <b>{t.cache.ttl[cache.ttl]}</b>
      </span>
    </TipValue>
  )
}

/**
 * The model the session answers with, without its route, as a task's run tag shows it; the provider beside it when not Claude.
 * Only the model's tail is cut; the tip has the full name.
 */
export function ModelFact({ agent, model }: { agent: string; model: string | null }) {
  const provider = agentLabel(agent)
  const value = model === null ? '—' : <>
    {agent !== CLAUDE && <span className="panel__model-provider">{provider}{' · '}</span>}
    <span className="panel__model-name">{modelName(model)}</span>
  </>
  return (
    <Fact label={t.session.model} className="panel__inline panel__model">
      <TipValue value={value}>
        <span className="panel__part">
          <span className="panel__part-label">{t.session.provider}</span>
          <b>{provider}</b>
        </span>
        {model !== null && (
          <span className="panel__part">
            <span className="panel__part-label">{t.session.modelOf}</span>
            <b>{model}</b>
          </span>
        )}
        <span className="panel__tip-note">{model === null ? t.session.modelYet : t.session.modelFrom}</span>
      </TipValue>
    </Fact>
  )
}

/**
 * The context on one line, as the CLI download meter: the label, a full-height divider, the bar, a short divider, the figures.
 * `wide` takes the whole row of facts; otherwise two of the three columns, beside Tokens.
 */
export function ContextFact({ label, tokens, window, scale, wide = false }: { label: string; tokens: number; window: number | null; scale: ContextScale; wide?: boolean }) {
  return (
    <Fact label={label} wide={wide} tone={contextFill(tokens, scale, window).level} className="panel__inline panel__context">
      <dd>
        <ContextMeter tokens={tokens} window={window} scale={scale} full />
      </dd>
    </Fact>
  )
}

/** The total alone; the split by kind is a tip under it, opened by pointing at the number or pressing it. */
export function TokensFact({ tokens }: { tokens: TokenTotals }) {
  const parts: [string, number][] = [
    [t.session.input, tokens.input],
    [t.session.output, tokens.output],
    [t.session.cacheRead, tokens.cacheRead],
    [t.session.cacheWrite, tokens.cacheWrite],
  ]
  return (
    <Fact label={t.session.tokens} className="panel__inline">
      <TipValue value={formatTokens(tokenTotal(tokens))}>
        {parts.map(([label, value]) => (
          <span key={label} className="panel__part">
            <span className="panel__part-label">{label}</span>
            <b>{formatTokens(value)}</b>
          </span>
        ))}
      </TipValue>
    </Fact>
  )
}

/** A fact's value whose details are a tip under it, opened by pointing at the value or pressing it. */
export function TipValue({ value, className = 'panel__value', children }: { value: ReactNode; className?: string; children: ReactNode }) {
  const { shown, anchor, tip, show, point, hide, close } = useTip<HTMLButtonElement, HTMLSpanElement>()
  return (
    <dd className={className}>
      <button
        ref={anchor}
        type="button"
        className="panel__total"
        aria-expanded={shown}
        onMouseEnter={point}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !shown) return
          event.preventDefault()
          event.stopPropagation()
          close()
        }}
      >
        {value}
        {shown && (
          <span ref={tip} popover="manual" className="panel__split" role="tooltip">
            {children}
          </span>
        )}
      </button>
    </dd>
  )
}
