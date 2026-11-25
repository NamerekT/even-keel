import { useId, useState, type CSSProperties } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import type { MachineSignIn } from '../../../src/state.js'
import { HUB_PLACE } from '../accountAdd.js'
import { machineAddChoices, type MachineAddChoice } from '../machineAdd.js'
import { t } from '../i18n/index.js'
import { CheckIcon } from '../ui/icons.js'
import { MachineMark } from '../ui/MachineIcon.js'
import { Tipped } from '../ui/Tipped.js'
import { AgentIcon } from './accountParts.js'
import { MachineClaudeSign } from './MachineClaudeSign.js'
import { MachineCliInstall } from './MachineCliInstall.js'
import './machineAccounts.css'

export interface Place {
  id: string
  /** The machine's id, the hub's own one for `HUB_PLACE`: its icon (BTN-1595). */
  machine: string
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
                  <span className="account-add__way-icon"><MachineMark id={place.machine} color={place.color} /></span>
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
 * The agents of a new account on a machine elsewhere (BTN-1302): one whose CLI the machine lacks opens its install there
 * (`MachineCliInstall`, BTN-1502); the pick signs in there and `MachineLoginDialog` follows it. Claude first asks how, as the hub does (BTN-1501): a full
 * sign-in or a long token (`MachineClaudeSign`).
 */
export function MachineAgents({ machine, accounts, busy, failure, back, onPick, onAdded }: AgentsProps) {
  const view = t.machinePanel.view
  const [claude, setClaude] = useState<MachineAddChoice | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)
  const choices = machineAddChoices(machine)
  // The step stays while the CLI is missing: once the machine finds it, its tile is there to pick.
  if (installing !== null && choices.some((choice) => choice.agent === installing && choice.missing)) {
    return <MachineCliInstall machine={machine} agent={installing} back={() => setInstalling(null)} />
  }
  if (claude !== null) {
    return (
      <MachineClaudeSign machine={machine} accounts={accounts} busy={busy} failure={failure} back={() => setClaude(null)} onFull={() => onPick(claude)} onAdded={onAdded} />
    )
  }
  const pick = (choice: MachineAddChoice) => (choice.agent === CLAUDE ? setClaude(choice) : onPick(choice))
  return (
    <>
      <div className="add-package__body">
        <p className="add-package__lead">{view.addLead}</p>
        <div className="add-package__kinds account-add__providers machine-add__agents">
          {choices.map((choice) => {
            const tile = (
              <button
                type="button"
                className="add-package__kind"
                disabled={busy}
                onClick={() => (choice.missing ? setInstalling(choice.agent) : pick(choice))}
              >
                <span className="add-package__kind-icon">
                  <AgentIcon agent={choice.agent} />
                </span>
                <span className="add-package__kind-title">{t.account.agents[choice.agent as keyof typeof t.account.agents]}</span>
                {choice.missing && <span className="tag account-add__missing">{t.account.cliNotFound}</span>}
                <span className="add-package__kind-desc">{gets(choice)}</span>
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
      {back !== null && (
        <footer className="add-package__foot">
          <button type="button" className="button" disabled={busy} onClick={back}>
            ← {t.account.back}
          </button>
          <span className="add-package__spacer" />
        </footer>
      )}
    </>
  )
}
