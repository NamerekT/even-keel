import { useState } from 'react'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import type { MachineToken } from '../machineAccountView.js'
import { Tipped } from '../ui/Tipped.js'
import { SessionsOnly } from './MachineSignIns.js'
import { MachineTokenDialog, type MachineTokenTarget } from './MachineTokenDialog.js'
import type { MachineRows } from './machineRows.js'

const WINDOWS_DIFFER = { code: 'usage.tokenWindowsDiffer', params: {} } as const

/**
 * Under a machine elsewhere's folder on a long token: "limits from sessions only" with "Sign in fully" on the hub
 * (BTN-1266), or "limits differ from the hub's" with "New token" for the hub's full sign-in of its e-mail (BTN-1267).
 */
export function MachineTokenNote({ token, machine }: { token: MachineToken; machine: MachineRows }) {
  const { state } = useLive()
  const { send, sending } = useCommand()
  const [target, setTarget] = useState<MachineTokenTarget | null>(null)
  if (!token.sessionsOnly && !token.limitsDiffer) return null
  const busy = sending || machine.busy
  const email = token.email
  const hub = email === null ? undefined : state?.account.accounts.find((entry) => entry.agent === 'claude' && entry.longToken === undefined && entry.status?.email === email)
  return <div className="account-machines">
    {token.sessionsOnly && <div className="account-machines__row"><SessionsOnly email={email} send={send} sending={busy} /></div>}
    {token.limitsDiffer && <div className="account-machines__row">
      <Tipped className="account-machines__token" tip={say(WINDOWS_DIFFER)} align="start" focusable>{t.machinePage.limitsDiffer}</Tipped>
      {hub !== undefined && machine.online && (
        <button type="button" className="button button--small" disabled={busy}
          onClick={() => setTarget({ machine: machine.card.id, name: machine.card.name, account: hub.key, who: email! })}>
          {t.account.newKey.longToken}
        </button>
      )}
    </div>}
    {target !== null && <MachineTokenDialog target={target} onClose={() => setTarget(null)} />}
  </div>
}
