import { useState } from 'react'
import { Link } from 'react-router'
import type { MachineCard } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { MachineAccountList, machineAccountsNone } from '../layout/MachineAccounts.js'
import { MachineAddAccount } from '../layout/MachineAddAccount.js'
import { useNow } from '../layout/useNow.js'
import { hubGapsOn } from '../machineAdd.js'
import { machinePath } from '../machineColor.js'
import { machineLogin } from '../machineSignIn.js'
import { AccountTag } from '../ui/AccountTag.js'
import { Tipped } from '../ui/Tipped.js'
import { Band, Card, EmptyState, PageHead } from '../ui/blocks.js'
import './accounts.css'

const agentName = (agent: string): string => t.account.agents[agent as keyof typeof t.account.agents] ?? agent

/**
 * A machine elsewhere's view of the accounts page (BTN-1279, BTN-1302): its accounts and the limits it read, a signed-out
 * one with "Sign in" there, then each hub subscription not signed in there with its "Sign in"; "Add account" adds one
 * on that machine alone. Every sign-in runs on the machine, followed by `MachineLoginDialog`.
 */
export function MachineAccountsPage({ card }: { card: MachineCard }) {
  const now = useNow(60_000)
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const [adding, setAdding] = useState(false)
  const view = t.machinePanel.view
  const signIns = state?.machineSignIns
  const signIn = signIns?.find((each) => each.machine === card.id)
  const online = signIn?.online ?? card.online
  const busy = sending || machineLogin(signIns) !== undefined
  const gaps = signIn === undefined ? [] : hubGapsOn(state?.account.accounts ?? [], signIn)
  const login = (agent: string, account?: string) => void send('machines/login', { machine: card.id, agent, ...(account !== undefined && { account }) })
  const signInOf = (agent: string, account?: string) => (
    <SignIn name={card.name} online={online} busy={busy} noCli={signIn?.missing.includes(agent) === true ? agentName(agent) : null} onClick={() => login(agent, account)} />
  )

  const add = online ? (
    <button type="button" className="button" disabled={busy} onClick={() => setAdding(true)}>
      + {t.account.add}
    </button>
  ) : (
    <Tipped tip={view.addOffline(card.name)} align="end">
      <button type="button" className="button" aria-disabled="true">
        + {t.account.add}
      </button>
    </Tipped>
  )
  const empty = card.accounts.length === 0 && gaps.length === 0
  // As on the own accounts page, an empty list carries "Add account" in its empty state rather than in the head.
  const actions = (
    <>
      <Link to={machinePath(card.id)} className="button">
        {view.machinePage}
      </Link>
      {!empty && add}
    </>
  )

  return (
    <div className="page accounts-page">
      <PageHead title={t.account.title} actions={actions} />
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      <Band tone="note">{view.accountsBand(card.name)}</Band>
      {empty ? (
        <EmptyState action={add}>{machineAccountsNone(card, signIns)}</EmptyState>
      ) : (
        <Card title={view.accountsOf(card.name)} titleId="machine-accounts-page">
          <MachineAccountList card={card} now={now} wide signOutAction={(account) => signInOf(account.agent, account.key)}>
            {gaps.map(({ entry, gap }) => (
              <li key={`hub:${entry.key}`} className="machine-accounts__row">
                <span className="machine-accounts__who">
                  <AccountTag account={entry.key} agent={entry.agent} />
                  <span className="machine-accounts__muted">{view.hubOnly}</span>
                </span>
                {signInOf(entry.agent, gap.account)}
              </li>
            ))}
          </MachineAccountList>
        </Card>
      )}
      {adding && <MachineAddAccount card={card} signIn={signIn} onClose={() => setAdding(false)} />}
    </div>
  )
}

/** "Sign in" on the machine: greyed with why while it is off the link; without the agent's CLI there, what to install instead. */
function SignIn({ name, online, busy, noCli, onClick }: { name: string; online: boolean; busy: boolean; noCli: string | null; onClick: () => void }) {
  if (noCli !== null) return <span className="machine-accounts__end machine-accounts__muted">{t.machines.noCli(noCli)}</span>
  return (
    <span className="machine-accounts__end">
      {online ? (
        <button type="button" className="button button--small" disabled={busy} onClick={onClick}>
          {t.account.login}
        </button>
      ) : (
        <Tipped tip={t.machines.offlineTip(name)} align="end">
          <button type="button" className="button button--small" aria-disabled="true">
            {t.account.login}
          </button>
        </Tipped>
      )}
    </span>
  )
}
