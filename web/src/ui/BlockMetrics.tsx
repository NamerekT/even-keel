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
    <div className={`block__now block__now--${percent === null ? 'unknown' : level}`} style={percent === null ? undefined : { '--fill': `${percent}%` } as CSSProperties}>
      {children}
      <div className="block__now-side">
        <Extras project={project} session={session} sessions={sessions} />
        {percent === null || session.contextWindow === null ? (
          <span className="block__now-value" aria-label={`${t.context.label}: ${formatTokens(session.contextTokens)}`}>{formatTokens(session.contextTokens)}</span>
        ) : (
          <Tipped tip={t.context.of(formatTokens(session.contextTokens), formatTokens(session.contextWindow), Math.round(percent))}>
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
        )}
      </div>
    </div>
  )
}

function Extras({ project, session, sessions }: { project: string; session: SessionView; sessions: TaskSession[] }) {
  const { state } = useLive()
  return (
    <>
      {foreignAccount(state?.account, project, session.account) && <AccountMark email={session.account!} />}
      <ResetsBadge sessions={sessions} />
    </>
  )
}

/** The task's context resets as an icon and a number, the breakdown in its tip; nothing while there were none. */
export function ResetsBadge({ sessions }: { sessions: TaskSession[] }) {
  const resets = contextResets(sessions)
  if (resets.total === 0) return null
  return (
    <Tipped tip={[<span key="title">{t.chain.resetsTitle}</span>, <span key="of">{t.chain.resetsOf(resets)}</span>]}>
      <span className="block__resets" role="img" aria-label={t.chain.resets(resets.total)}>
        <HandoffIcon />
        {resets.total}
      </span>
    </Tipped>
  )
}

const RING_RADIUS = 5

/** `note` is a last line of the tip: the row's priority, whose own `title` the ring replaces so that two tips never open at once. */
export function CacheRing({ cache, note }: { cache: CacheWindow; note?: string }) {
  const now = useNow(1_000)
  const { left, level } = cacheFreshness(cache, now)
  const at = formatMoment(cache.until, now)
  const length = 2 * Math.PI * RING_RADIUS
  const label = t.cache.label(level === 'cold' ? t.cache.coldValue : formatClock(left))
  const tip = [
    <span key="left">{label}</span>,
    <span key="at">{level === 'cold' ? t.cache.cold(at) : t.cache.warm(at, t.cache.ttl[cache.ttl])}</span>,
    note !== undefined && <span key="note">{note}</span>,
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
