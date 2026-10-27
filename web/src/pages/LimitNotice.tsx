import type { LimitHold } from '../../../src/chain/relay.js'
import type { SessionView } from '../../../src/state.js'
import { accountName, agentLabel } from '../accountName.js'
import { formatMoment } from '../format.js'
import { t } from '../i18n/index.js'
import { useNow } from '../layout/useNow.js'
import { useLive } from '../live/context.js'
import { taskProject } from '../state.js'
import { Band } from '../ui/blocks.js'
import { FixButton } from './FixButtons.js'
import { limitMessages, type LimitRefusal } from './limitMessages.js'
import './limitNotice.css'

export function LimitNotice({ session, hold, refusal }: { session: SessionView; hold: LimitHold | null; refusal: LimitRefusal | null }) {
  const { state } = useLive()
  const now = useNow(1_000)
  const accounts = state?.account.accounts ?? []
  const messages = limitMessages(hold, now, session, accounts, refusal)
  const [latest, ...earlier] = messages
  if (latest === undefined) return null
  const entry = accounts.find((each) => each.key === session.account)
  const name = entry === undefined ? session.account ?? agentLabel(session.agent) : accountName(entry, accounts)
  const transient = session.apiErrorKind === 'transient'
  return (
    <Band
      tone={transient ? 'warn' : 'error'}
      className="limit-notice"
      action={transient ? undefined : <FixButton project={taskProject(state, session.task)} fix={{ to: 'project', tab: 'sessions' }} />}
    >
      <p className="limit-notice__latest">{latest.text}</p>
      {!transient && latest.kind !== 'refusal' && <p className="limit-notice__account">{t.session.limitAccount(agentLabel(session.agent), name)}</p>}
      {earlier.length > 0 && (
        <details className="limit-notice__details">
          <summary>{t.session.limitDetails(earlier.length)}</summary>
          <ol>
            {earlier.map((message) => <li key={message.kind}><time dateTime={message.at}>{formatMoment(message.at, now)}</time><p>{message.text}</p></li>)}
          </ol>
        </details>
      )}
    </Band>
  )
}
