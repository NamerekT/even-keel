import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import type { MachineCard, MachineCardAccount } from '../../../src/state.js'
import { limitSpans } from '../../../src/limits/model.js'
import { accountOf } from '../accountName.js'
import { entrySlot } from '../accounts.js'
import { t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { machinePath } from '../machineColor.js'
import { AccountTag } from '../ui/AccountTag.js'
import { ServerIcon } from '../ui/icons.js'
import { seriesStyle } from '../ui/series.js'
import { LimitSegment } from './AccountBlock.js'
import { Limits } from './Limits.js'
import { useMachineFilter } from './MachineFilter.js'
import { usePopover } from './usePopover.js'
import './machineAccounts.css'

/** How the hub knows a machine's account: the own one's by its folder, one elsewhere's by its e-mail. */
const hubName = (card: MachineCard, account: MachineCardAccount): string => (card.own ? account.key : (account.email ?? account.key))

/**
 * The header's accounts block in a machine's view (BTN-1279): a machine elsewhere's launch account and its limits, a
 * press lists its accounts; in "All machines" one block for every machine, its menu a section per machine. The own
 * machine's view keeps the hub's own block (`AccountBlock`).
 */
export function MachineAccountsBlock({ now }: { now: Date }) {
  const { cards, selected } = useMachineFilter()
  const { open, setOpen, rootRef } = usePopover()
  const shown = selected === null ? cards : [selected]
  const label = selected === null ? t.machinePanel.view.accountsAll(cards.length) : t.machinePanel.view.accountsOf(selected.name)
  return (
    <div className="queue-menu machine-accounts" ref={rootRef}>
      <button type="button" className="hblock account-block__toggle" aria-expanded={open} aria-controls="machine-accounts" aria-label={label} title={label} onClick={() => setOpen(!open)}>
        {selected === null ? <AllToggle cards={cards} /> : <MachineToggle card={selected} now={now} />}
      </button>
      {open && (
        <div id="machine-accounts" className="queue machine-accounts__panel" role="dialog" aria-label={label}>
          {shown.map((card) => (
            <MachineSection key={card.id} card={card} now={now} several={selected === null} onPick={() => setOpen(false)} />
          ))}
        </div>
      )}
    </div>
  )
}

function AllToggle({ cards }: { cards: MachineCard[] }) {
  return (
    <span className="hblock__seg machine-accounts__all">
      {t.machinePanel.view.accounts}
      <span className="machine-accounts__marks" aria-hidden="true">
        {cards.map((card) => (
          <span key={card.id} className="machine-accounts__mark" style={{ '--machine': card.color } as CSSProperties} />
        ))}
      </span>
    </span>
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

function MachineSection({ card, now, several, onPick }: { card: MachineCard; now: Date; several: boolean; onPick: () => void }) {
  const { select } = useMachineFilter()
  const view = t.machinePanel.view
  return (
    <section className="queue__section machine-accounts__section" style={{ '--machine': card.color } as CSSProperties}>
      <h2 className="queue__heading machine-accounts__head">
        <span className="machine-accounts__mark" aria-hidden="true" />
        <span className="machine-accounts__name">{card.name}</span>
        {several && (
          <button
            type="button"
            className="machine-accounts__action"
            onClick={() => {
              select(card.id)
              onPick()
            }}
          >
            {view.show}
          </button>
        )}
        {card.own ? (
          <Link to="/accounts" className="machine-accounts__action">
            {view.accountsPage}
          </Link>
        ) : (
          <Link to={machinePath(card.id)} className="machine-accounts__action" aria-label={t.machinePanel.page(card.name)}>
            <ServerIcon />
          </Link>
        )}
      </h2>
      {card.accounts.length === 0 ? <p className="queue__empty">{view.accountsNone}</p> : <MachineAccountList card={card} now={now} />}
    </section>
  )
}

/** A machine's accounts: the launch one marked, one signed out said so, the limits the machine read under each. */
export function MachineAccountList({ card, now, wide = false }: { card: MachineCard; now: Date; wide?: boolean }) {
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
          {account.signedIn && <Limits limits={account.limits} now={now} bare={!wide} />}
        </li>
      ))}
    </ul>
  )
}
