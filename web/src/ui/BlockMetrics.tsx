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
}

/** The chain row's metrics in one line: the cache ring, the context bar, an account other than the project's, the context resets. */
export function BlockMetrics({ project, session, sessions, scale }: BlockMetricsProps) {
  const { state } = useLive()
  const resets = contextResets(sessions)
  const { percent } = contextFill(session.contextTokens, scale, session.contextWindow)
  const window = session.contextWindow ?? scale.window

  return (
    <div className="block__metrics">
      {session.cache !== null && <CacheRing cache={session.cache} />}
      <Tipped tip={t.context.of(formatTokens(session.contextTokens), formatTokens(window), Math.round(percent))} align="start">
        <ContextMeter tokens={session.contextTokens} window={session.contextWindow} scale={scale} brief />
      </Tipped>
      {foreignAccount(state?.account, project, session.account) && <AccountMark email={session.account!} />}
      {resets.total > 0 && (
        <Tipped tip={[<span key="title">{t.chain.resetsTitle}</span>, <span key="of">{t.chain.resetsOf(resets)}</span>]}>
          <span className="block__resets" role="img" aria-label={t.chain.resets(resets.total)}>
            <HandoffIcon />
            {resets.total}
          </span>
        </Tipped>
      )}
    </div>
  )
}

const RING_RADIUS = 5

function CacheRing({ cache }: { cache: CacheWindow }) {
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
