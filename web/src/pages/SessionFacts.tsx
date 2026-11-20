import type { ReactNode } from 'react'
import { CLAUDE } from '../../../src/claude/name.js'
import type { CacheWindow, TokenTotals } from '../../../src/sessions/transcript.js'
import type { ContextScale, KeptWarm } from '../../../src/state.js'
import { agentLabel } from '../accountName.js'
import { formatLineTime, formatMoment, formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { cacheFreshness, contextFill, tokenTotal } from '../state.js'
import { Fact } from '../ui/blocks.js'
import { CacheClock } from '../ui/CacheClock.js'
import { ContextMeter } from '../ui/ContextMeter.js'
import { modelTip } from '../ui/modelLabel.js'
import { ModelName } from '../ui/ModelName.js'
import { EffortBars } from '../ui/RunLabelTag.js'
import { useTip } from '../ui/useTip.js'

/**
 * The cache clock; the tip, the only one it has (EKR-145), says until when it is warm or since when cold, its lifetime and,
 * when keep-warm pinged it this stretch of idleness, how often and when last (EKR-143).
 */
export function CacheFact({ cache, warm }: { cache: CacheWindow; warm: KeptWarm | null }) {
  const now = useNow(1_000)
  const cold = cacheFreshness(cache, now).level === 'cold'
  return (
    <TipValue value={<CacheClock cache={cache} bare />}>
      <span className="panel__part">
        <span className="panel__part-label">{cold ? t.session.coldAt : t.session.warmUntil}</span>
        <b><time dateTime={cache.until}>{formatMoment(cache.until, now)}</time></b>
      </span>
      <span className="panel__part">
        <span className="panel__part-label">{t.session.lifetime}</span>
        <b>{t.cache.ttl[cache.ttl]}</b>
      </span>
      {cold && <span className="panel__tip-note">{t.session.coldNote}</span>}
      {!cold && warm === null && <span className="panel__tip-note">{t.session.renewsNote}</span>}
      {warm !== null && <>
        <span className="panel__part">
          <span className="panel__part-label">{t.session.renewed}</span>
          <b>{t.session.renewals(warm.pings)}</b>
        </span>
        <span className="panel__part">
          <span className="panel__part-label">{t.session.lastPing}</span>
          <b><time dateTime={warm.at}>{formatLineTime(warm.at)}</time></b>
        </span>
        <span className="panel__tip-note">{t.session.keptWarm}</span>
      </>}
    </TipValue>
  )
}

/**
 * The model the session answers with, by its short name (`shortModel`), its effort as a bar scale after it; the provider before it when not Claude.
 * Only the model's tail is cut; the tip has the full name and the id.
 */
export function ModelFact({ agent, model, title, effort }: { agent: string; model: string | null; title?: string | undefined; effort: string | null }) {
  const provider = agentLabel(agent)
  const value = model === null ? '—' : <>
    {agent !== CLAUDE && <span className="panel__model-provider">{provider}{' | '}</span>}
    <ModelName model={model} title={title} className="panel__model-name" />
    <EffortBars effort={effort} spaced className="panel__model-effort" />
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
            <b>{modelTip(model, title)}</b>
          </span>
        )}
        {model !== null && effort !== null && (
          <span className="panel__part">
            <span className="panel__part-label">{t.session.effortOf}</span>
            <b>{effort}</b>
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
