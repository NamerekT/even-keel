import { useId, useState, type CSSProperties } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import type { MachineSignIn } from '../../../src/state.js'
import { HUB_PLACE } from '../accountAdd.js'
import { machineAddChoices, tokenAccounts, type MachineAddChoice } from '../machineAdd.js'
import { t } from '../i18n/index.js'
import { CheckIcon, EvenKeelIcon, ServerIcon } from '../ui/icons.js'
import { Tipped } from '../ui/Tipped.js'
import { AgentIcon } from './accountParts.js'
import { MachineTokenDialog, type MachineTokenTarget } from './MachineTokenDialog.js'
import './machineAccounts.css'

export interface Place {
  id: string
  name: string
  color: string | undefined
  online: boolean
}

/**
 * The first step of "Add account" while the hub has machines elsewhere (BTN-1308): the hub or one machine on the link,
 * `initial` picked; a machine off the link is off with why.
 */
export function PlacePick({ places, initial, onNext }: { places: Place[]; initial: string; onNext: (place: string) => void }) {
  const group = useId()
  const [picked, setPicked] = useState(initial)
  const words = t.addAccount.place
  return (
    <form
      className="add-package__form"
      onSubmit={(event) => {
        event.preventDefault()
        onNext(picked)
      }}
    >
      <div className="add-package__body">
        <fieldset className="add-package__field">
          <legend className="add-package__label add-package__legend">{words.legend}</legend>
          <div className="account-add__ways">
            {places.map((place, index) => {
              const card = (
                <label key={place.id} className="account-add__way account-add__place" style={{ '--machine': place.color } as CSSProperties} aria-disabled={place.online ? undefined : 'true'}>
                  <input type="radio" name={group} value={place.id} checked={place.id === picked} disabled={!place.online} onChange={() => setPicked(place.id)} />
                  <span className="account-add__way-icon">{place.id === HUB_PLACE ? <EvenKeelIcon /> : <ServerIcon />}</span>
                  <span className="account-add__way-title">{place.name}</span>
                  <span className="account-add__way-check">
                    <CheckIcon />
                  </span>
                  <span className="account-add__way-gets">{place.id === HUB_PLACE ? words.hub : place.online ? words.machine : words.offline}</span>
                </label>
              )
              return place.online ? card : (
                <Tipped key={place.id} className="account-add__place-tip" tip={t.machinePanel.view.addOffline(place.name)} align={index % 2 === 0 ? 'start' : 'end'}>
                  {card}
                </Tipped>
              )
            })}
          </div>
        </fieldset>
      </div>
      <footer className="add-package__foot">
        <span className="add-package__spacer" />
        <button type="submit" className="button button--primary">
          {words.next}
        </button>
      </footer>
    </form>
  )
}

const gets = ({ agent, method }: MachineAddChoice): string =>
  (t.addAccount.way as unknown as Record<string, Record<string, { gets: string } | undefined> | undefined>)[agent]?.[method ?? 'subscription']?.gets ?? ''

interface AgentsProps {
  machine: MachineSignIn
  /** The hub's accounts: a long token is tied to one of them. */
  accounts: AccountEntry[]
  busy: boolean
  failure: string | null
  back: (() => void) | null
  onPick: (choice: MachineAddChoice) => void
  /** The machine took a long token: the account is there. */
  onAdded: () => void
}

/**
 * The agents of a new account on a machine elsewhere (BTN-1302): one whose CLI the machine lacks is off with why; the
 * pick signs in there and `MachineLoginDialog` follows it. A long token of a hub Claude subscription is the way without
 * a browser (`MachineTokenDialog`).
 */
export function MachineAgents({ machine, accounts, busy, failure, back, onPick, onAdded }: AgentsProps) {
  const view = t.machinePanel.view
  const [token, setToken] = useState<MachineTokenTarget | null>(null)
  const choices = machineAddChoices(machine)
  const claude = choices.some((choice) => choice.agent === CLAUDE && !choice.missing)
  const tied = tokenAccounts(accounts, machine)
  const longToken = (
    <button
      type="button"
      className="button"
      {...(tied.length === 0
        ? { 'aria-disabled': 'true' as const }
        : { disabled: busy, onClick: () => setToken({ machine: machine.machine, name: machine.name, ...tied[0]! }) })}
    >
      {t.account.machineToken}
    </button>
  )
  return (
    <>
      <div className="add-package__body">
        <p className="add-package__note">{view.addLead}</p>
        <div className="add-package__kinds account-add__providers machine-add__agents">
          {choices.map((choice) => {
            const tile = (
              <button
                type="button"
                className="add-package__kind"
                {...(choice.missing ? { 'aria-disabled': 'true' as const } : { disabled: busy, onClick: () => onPick(choice) })}
              >
                <span className="add-package__kind-icon">
                  <AgentIcon agent={choice.agent} />
                </span>
                <span className="add-package__kind-title">{t.account.agents[choice.agent as keyof typeof t.account.agents]}</span>
                {choice.missing && <span className="tag account-add__missing">{t.account.cliNotFound}</span>}
                <span className="add-package__kind-hint">{gets(choice)}</span>
              </button>
            )
            return choice.missing ? (
              <Tipped key={choice.agent} className="machine-add__agent" tip={view.addNoCli(machine.name)} align="start">
                {tile}
              </Tipped>
            ) : (
              <div key={choice.agent} className="machine-add__agent">{tile}</div>
            )
          })}
        </div>
      </div>
      {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{failure}</p>}
      {(back !== null || claude) && (
        <footer className="add-package__foot">
          {back !== null && (
            <button type="button" className="button" disabled={busy} onClick={back}>
              ← {t.account.back}
            </button>
          )}
          <span className="add-package__spacer" />
          {claude && (
            <Tipped tip={tied.length === 0 ? t.addAccount.place.tokenNone(machine.name) : t.account.machineTokenTip} align="end">
              {longToken}
            </Tipped>
          )}
        </footer>
      )}
      {token !== null && <MachineTokenDialog target={token} choices={tied} onClose={() => setToken(null)} onAdded={onAdded} />}
    </>
  )
}
