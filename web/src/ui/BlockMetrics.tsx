import type { CSSProperties, ReactNode } from 'react'
import type { TaskSession } from '../../../src/chain/launches.js'
import type { CacheWindow } from '../../../src/sessions/transcript.js'
import type { ContextScale, SessionView } from '../../../src/state.js'
import { accountSlot, foreignAccount } from '../accounts.js'
import { formatClock, formatMoment, formatTokens } from '../format.js'
import { t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { cacheFreshness, cacheShare, contextFill, contextResets } from '../state.js'
import { ContextMeter } from './ContextMeter.js'
import { HandoffIcon } from './icons.js'
import { seriesStyle } from './series.js'
import { Tipped } from './Tipped.js'
import './blockMetrics.css'

interface BlockMetricsProps {
  project: string
  session: SessionView
  sessions: TaskSession[]
  scale: ContextScale
  /** The cache ring goes here only when the number's place does not hold it. */
  ring: boolean
}

/** The metrics of a one-line chain row: the cache ring, the context bar, an account other than the project's, the context resets. */
export function BlockMetrics({ project, session, sessions, scale, ring }: BlockMetricsProps) {
  const { percent } = contextFill(session.contextTokens, scale, session.contextWindow)

  return (
    <div className="block__metrics">
      {ring && session.cache !== null && <CacheRing cache={session.cache} />}
      <Tipped tip={contextTip(session, scale, percent)} align="start">
        <ContextMeter tokens={session.contextTokens} window={session.contextWindow} scale={scale} brief />
      </Tipped>
      <Extras project={project} session={session} sessions={sessions} />
    </div>
  )
}

interface ActionMeterProps {
  project: string
  session: SessionView
  sessions: TaskSession[]
  scale: ContextScale
  /** The session's current action, or an empty line while it has none. */
  children: ReactNode
}

/** The second line of a row whose session works: its current action on a field filled up to the context level, the percent at the end. */
export function ActionMeter({ project, session, sessions, scale, children }: ActionMeterProps) {
  const { percent, level } = contextFill(session.contextTokens, scale, session.contextWindow)

  return (
    <div className={`block__now block__now--${level}`} style={{ '--fill': `${percent}%` } as CSSProperties}>
      {children}
      <div className="block__now-side">
        <Extras project={project} session={session} sessions={sessions} />
        <Tipped tip={contextTip(session, scale, percent)}>
          <span
            className="block__now-value"
            role="meter"
            aria-label={t.context.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            {Math.round(percent)}%
          </span>
        </Tipped>
      </div>
    </div>
  )
}

function contextTip(session: SessionView, scale: ContextScale, percent: number): string {
  return t.context.of(formatTokens(session.contextTokens), formatTokens(session.contextWindow ?? scale.window), Math.round(percent))
}

function Extras({ project, session, sessions }: { project: string; session: SessionView; sessions: TaskSession[] }) {
  const { state } = useLive()
  const resets = contextResets(sessions)
  return (
    <>
      {foreignAccount(state?.account, project, session.account) && <AccountMark email={session.account!} />}
      {resets.total > 0 && (
        <Tipped tip={[<span key="title">{t.chain.resetsTitle}</span>, <span key="of">{t.chain.resetsOf(resets)}</span>]}>
          <span className="block__resets" role="img" aria-label={t.chain.resets(resets.total)}>
            <HandoffIcon />
            {resets.total}
          </span>
        </Tipped>
      )}
    </>
  )
}

const RING_RADIUS = 5

export function CacheRing({ cache }: { cache: CacheWindow }) {
  const now = useNow(1_000)
  const { left, level } = cacheFreshness(cache, now)
  const at = formatMoment(cache.until, now)
  const length = 2 * Math.PI * RING_RADIUS
  const label = t.cache.label(level === 'cold' ? t.cache.coldValue : formatClock(left))
  const tip = [
    <span key="left">{label}</span>,
    <span key="at">{level === 'cold' ? t.cache.cold(at) : t.cache.warm(at, t.cache.ttl[cache.ttl])}</span>,
  ]
  return (
    <Tipped tip={tip} align="start">
      <svg className={`cache-ring cache-ring--${level}`} viewBox="0 0 14 14" width="14" height="14" role="img" aria-label={label}>
        <circle className="cache-ring__track" cx="7" cy="7" r={RING_RADIUS} />
        <circle
          className="cache-ring__left"
          cx="7"
          cy="7"
          r={RING_RADIUS}
          strokeDasharray={`${cacheShare(cache, now) * length} ${length}`}
        />
      </svg>
    </Tipped>
  )
}

function AccountMark({ email }: { email: string }) {
  const { state } = useLive()
  return (
    <Tipped tip={t.chain.accountMark(email)}>
      <span className="block__account" style={seriesStyle(accountSlot(state?.account, email))} role="img" aria-label={t.session.account(email)}>
        {email.charAt(0).toUpperCase()}
      </span>
    </Tipped>
  )
}
