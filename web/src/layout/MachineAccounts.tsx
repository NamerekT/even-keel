import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { MachineCard, MachineCardAccount, MachineSignIn } from '../../../src/state.js'
import { limitSpans } from '../../../src/limits/model.js'
import { accountOf } from '../accountName.js'
import { entrySlot } from '../accounts.js'
import { headerAccounts, type HeaderAccount } from '../headerAccounts.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { machineAccountsEmpty } from '../machineAdd.js'
import { AccountTag } from '../ui/AccountTag.js'
import { MachineLabel, MachineLabels } from '../ui/MachineLabel.js'
import { seriesStyle } from '../ui/series.js'
import { LimitSegment } from './AccountBlock.js'
import { AgentIcon } from './accountParts.js'
import { Limits } from './Limits.js'
import { useMachineFilter } from './MachineFilter.js'
import { usePopover } from './usePopover.js'
import './machineAccounts.css'

/** How the hub knows a machine's account: the own one's by its folder, one elsewhere's by its e-mail. */
const hubName = (card: MachineCard, account: MachineCardAccount): string => (card.own ? account.key : (account.email ?? account.key))

/**
 * The header's accounts block in a machine's view (BTN-1279): a machine elsewhere's launch account and its limits, a
 * press lists its accounts. In "All machines" a lamp per account Even Keel uses, its window a block per account with
 * the machines it is signed in on as labels (BTN-1309). The own machine's view keeps the hub's own block (`AccountBlock`).
 */
export function MachineAccountsBlock({ now }: { now: Date }) {
  const { cards, selected } = useMachineFilter()
  const { state } = useLive()
  const { open, setOpen, rootRef } = usePopover()
  const blocks = state === null ? [] : headerAccounts(cards, state.account)
  const label = selected === null ? t.machinePanel.view.accountsAll(blocks.length) : t.machinePanel.view.accountsOf(selected.name)
  return (
    <div className="queue-menu machine-accounts" ref={rootRef}>
      <button type="button" className="hblock account-block__toggle" aria-expanded={open} aria-controls="machine-accounts" aria-label={label} title={label} onClick={() => setOpen(!open)}>
        {selected === null ? <AllToggle blocks={blocks} /> : <MachineToggle card={selected} now={now} />}
      </button>
      {open && (
        <div id="machine-accounts" className="queue machine-accounts__panel" role="dialog" aria-label={label}
          onClickCapture={(event) => (event.target as Element).closest('a') !== null && setOpen(false)}>
          {selected === null ? <AccountBlocks blocks={blocks} now={now} /> : <MachineSection card={selected} now={now} />}
        </div>
      )}
    </div>
  )
}

function AllToggle({ blocks }: { blocks: HeaderAccount[] }) {
  const { state } = useLive()
  return (
    <span className="hblock__seg machine-accounts__all">
      {t.machinePanel.view.accounts}
      <span className="machine-accounts__marks" aria-hidden="true">
        {blocks.map((block) => (
          <span key={block.id} className="machine-accounts__lamp" style={seriesStyle(block.entry === undefined || state === null ? null : entrySlot(state.account, block.entry))} />
        ))}
      </span>
    </span>
  )
}

/** "All machines": an account a block — its e-mail, its limits once, the machines it is signed in on — then the page of all. */
function AccountBlocks({ blocks, now }: { blocks: HeaderAccount[]; now: Date }) {
  const { state } = useLive()
  const view = t.machinePanel.view
  return (
    <>
      {blocks.length === 0 ? <p className="queue__empty">{view.accountsUnused}</p> : (
        <ul className="machine-accounts__list">
          {blocks.map((block) => (
            <li key={block.id} className="machine-accounts__row" style={seriesStyle(block.entry === undefined || state === null ? null : entrySlot(state.account, block.entry))}>
              <span className="machine-accounts__who">
                <AgentIcon agent={block.agent} />
                <span className="machine-accounts__dot" aria-hidden="true" />
                <span className="machine-accounts__email">{block.email ?? block.entry?.name ?? block.key}</span>
              </span>
              {block.limits !== null && <Limits limits={block.limits} now={now} bare />}
              <MachineLabels items={block.machines.map((machine) => ({
                id: machine.id, name: machine.name, color: machine.color, kind: machine.token ? 'token' : 'in',
                ...(machine.token && { tip: t.account.machineOnTokenTip(machine.name) }),
              }))} />
            </li>
          ))}
        </ul>
      )}
      <Link to="/accounts" className="machine-accounts__all-link">{view.allAccounts}</Link>
    </>
  )
}

function MachineToggle({ card, now }: { card: MachineCard; now: Date }) {
  const { state } = useLive()
  const active = card.accounts.find((account) => account.key === card.active) ?? card.accounts.find((account) => account.signedIn)
  if (active === undefined) return <span className="hblock__seg machine-accounts__none">{t.machinePanel.view.accounts}</span>
  const entry = accountOf(state?.account, hubName(card, active), active.agent)
  const name = active.name ?? entry?.name ?? active.email?.split('@')[0] ?? active.key
  const spans = limitSpans(active.limits).filter((span) => active.limits?.[span] != null)
  return (
    <span className="account-block__group">
      <span className="hblock__seg" style={seriesStyle(entry === undefined || state === null ? null : entrySlot(state.account, entry))}>
        <span className="queue-toggle__dot" aria-hidden="true" />
        <span className="account-toggle__label">{name}</span>
      </span>
      {spans.map((span) => (
        <LimitSegment key={span} window={active.limits![span]!} now={now} outdated={false} />
      ))}
    </span>
  )
}

/** A machine elsewhere's view: its accounts, under its label that opens its page. */
function MachineSection({ card, now }: { card: MachineCard; now: Date }) {
  const { state } = useLive()
  return (
    <section className="queue__section machine-accounts__section">
      <h2 className="queue__heading machine-accounts__head">
        <MachineLabel id={card.id} name={card.name} color={card.color} />
      </h2>
      {card.accounts.length === 0 ? <p className="queue__empty">{machineAccountsNone(card, state?.machineSignIns)}</p> : <MachineAccountList card={card} now={now} />}
    </section>
  )
}

/** Why a machine lists no account: none yet before its first snapshot, else none at all. */
export function machineAccountsNone(card: MachineCard, signIns: MachineSignIn[] | undefined): string {
  const view = t.machinePanel.view
  return !card.own && machineAccountsEmpty(card.id, signIns) === 'waiting' ? view.accountsNone : view.accountsEmpty(card.name)
}

interface MachineAccountListProps {
  card: MachineCard
  now: Date
  wide?: boolean
  /** What a signed-out row holds at its right: its sign-in there (the accounts page). */
  signOutAction?: (account: MachineCardAccount) => ReactNode
  /** Rows after the machine's own: the hub's accounts not signed in there. */
  children?: ReactNode
}

/** A machine's accounts: the launch one marked, one signed out said so, the limits the machine read under each. */
export function MachineAccountList({ card, now, wide = false, signOutAction, children }: MachineAccountListProps) {
  const view = t.machinePanel.view
  return (
    <ul className={wide ? 'machine-accounts__list machine-accounts__list--wide' : 'machine-accounts__list'}>
      {card.accounts.map((account) => (
        <li key={`${account.agent}:${account.key}`} className="machine-accounts__row">
          <span className="machine-accounts__who">
            <AccountTag account={hubName(card, account)} agent={account.agent} />
            {account.key === card.active && (
              <span className="tag" title={view.launchTip}>
                {view.launch}
              </span>
            )}
            {!account.signedIn && <span className="machine-accounts__warn">{view.signedOut}</span>}
          </span>
          {account.signedIn ? <Limits limits={account.limits} now={now} bare={!wide} /> : signOutAction?.(account)}
        </li>
      ))}
      {children}
    </ul>
  )
}
