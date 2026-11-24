import type { MachineCard } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { AccountGroups } from '../layout/accountRows.js'
import { useOpenAdd } from '../layout/AddAccountDialog.js'
import { machineAccountsNone, useMachineRows } from '../layout/MachineAccounts.js'
import { useNow } from '../layout/useNow.js'
import { MachineLabel } from '../ui/MachineLabel.js'
import { Tipped } from '../ui/Tipped.js'
import { EmptyState } from '../ui/blocks.js'
import { AccountsFrame } from './AccountsFrame.js'
import './accounts.css'

/**
 * A machine elsewhere's view of the accounts page (BTN-1279, BTN-1570): the hub's table over its accounts and the limits
 * it read, no "Machines" column; a row it is not signed in to — its own folder signed out or a hub subscription not
 * there — with "Sign in" there. "Add account" opens the pick of the place on that machine. With `onClose` it is the
 * header's drawer of the machine's view (BTN-1587).
 */
export function MachineAccountsPage({ card, onClose }: { card: MachineCard; onClose?: () => void }) {
  const now = useNow(60_000)
  const { state } = useLive()
  const openAdd = useOpenAdd()
  const rows = useMachineRows(card)
  if (rows === null) return null
  const add = rows.online ? (
    <button type="button" className="button" disabled={rows.addOff} onClick={() => { onClose?.(); openAdd(null) }}>
      + {t.account.add}
    </button>
  ) : (
    <Tipped tip={t.machinePanel.view.addOffline(card.name)} align="end">
      <button type="button" className="button" aria-disabled="true">
        + {t.account.add}
      </button>
    </Tipped>
  )
  const empty = rows.view.accounts.length === 0
  return (
    <AccountsFrame title={<>{t.account.title} <MachineLabel id={card.id} name={card.name} color={card.color} /></>} actions={empty ? undefined : add} onClose={onClose}>
      {/* As on the own accounts page, an empty list carries "Add account" in its empty state rather than in the head. */}
      {rows.failure !== null && <p className="notice notice--error">{say(rows.failure)}</p>}
      {empty ? <EmptyState action={add}>{machineAccountsNone(card, state?.machineSignIns)}</EmptyState>
        : <AccountGroups view={rows.view} now={now} spend={null} tokens={null} sending={rows.busy} send={async () => false} machine={rows} page />}
    </AccountsFrame>
  )
}
