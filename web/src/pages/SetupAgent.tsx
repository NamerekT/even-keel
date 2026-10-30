import { useEffect, useRef } from 'react'
import type { EvenKeelState } from '../../../src/state.js'
import { PROVIDERS, readinessOf, type Provider } from '../accounts.js'
import { accountName } from '../accountName.js'
import { say, t } from '../i18n/index.js'
import { AgentIcon } from '../layout/accountParts.js'
import { useOpenAdd } from '../layout/AddAccountDialog.js'
import { CliSourceChoice } from '../layout/CliSource.js'
import { cliText } from '../layout/cliText.js'
import { useCommand } from '../live/useCommand.js'
import { CheckIcon } from '../ui/icons.js'
import { ChosenMark, type Save } from './SetupChoices.js'
import { Section } from './settingsParts.js'
import { cliRunnable } from './setupSteps.js'
import type { StepCheck } from './wizard.js'
import { StepDot } from './WizardFrame.js'
import { copilotNote } from '../../../src/opencode/support.js'
import './providerChoices.css'
import { providerHint } from '../accountAdd.js'

/**
 * The setup's agent (BTN-346, BTN-603) in the project wizard's parts, each with its dot: a card per provider that says
 * only whether its CLI is on the machine, then the chosen one's CLI and its account — in that order because the
 * sign-in goes through the CLI.
 */
export function AgentStep({ state, save, sending }: { state: EvenKeelState; save: Save; sending: boolean }) {
  const provider = state.config.shared.provider
  const known = PROVIDERS.includes(provider as Provider)
  return (
    <>
      <Section title={t.setup.titles.agent} mark={<Dot check={known ? 'passed' : 'empty'} first />} className="project-add__step">
        <p className="setup__lead">{t.setup.agentLead}</p>
        <ul className="setup-agents">
          {PROVIDERS.map((each) => (
            <AgentCard key={each} state={state} provider={each} chosen={each === provider} disabled={sending} onPick={() => void save({ provider: each })} />
          ))}
        </ul>
      </Section>
      {known && <ChosenAgent key={provider} state={state} provider={provider as Provider} save={save} />}
    </>
  )
}

/** A part's dot as the project wizard draws it: a check once done, a ring on the first part still to do. */
function Dot({ check, first = false }: { check: StepCheck; first?: boolean }) {
  const mark = check !== 'empty' ? check : first ? 'current' : 'future'
  return <StepDot mark={mark} label={t.wizard.marks[mark]} />
}

interface CardProps {
  state: EvenKeelState
  provider: Provider
  chosen: boolean
  disabled: boolean
  onPick: () => void
}

/** The pick is the card's button stretched over it. */
function AgentCard({ state, provider, chosen, disabled, onPick }: CardProps) {
  const copy = state.cliCopies?.[provider]
  const installed = copy ? copy.system : !state.account.missing.includes(provider)
  const text = cliText()
  return (
    <li className="setup-agent" aria-current={chosen ? 'true' : undefined}>
      <button type="button" className="setup-agent__pick" aria-pressed={chosen} disabled={disabled} onClick={onPick}>
        <span className="setup-agent__icon">
          <AgentIcon agent={provider} />
        </span>
        <span className="setup-agent__name">{t.account.agents[provider]}</span>
        <span className="setup-agent__hint">{providerHint(provider)}</span>
      </button>
      {chosen && <ChosenMark />}
      <div className="setup-agent__cli">{installed ? text.installed(copy?.installed ?? null) : text.absent}</div>
    </li>
  )
}

/**
 * The chosen agent's CLI and account. A download that ends for a provider without an account opens the account's
 * adding at once (BTN-542): the copy was fetched to sign in with it.
 */
function ChosenAgent({ state, provider, save }: { state: EvenKeelState; provider: Provider; save: Save }) {
  const openAdd = useOpenAdd()
  const copy = state.cliCopies?.[provider]
  const key = state.config.shared.accounts[provider] ?? ''
  const signedUp = state.account.accounts.some((each) => each.key === key && each.agent === provider)
  const status = copy?.status
  const before = useRef(status)
  useEffect(() => {
    const was = before.current
    before.current = status
    if (was === 'downloading' && status === 'ready' && !signedUp) openAdd(provider)
  }, [status])
  const runnable = cliRunnable(provider, copy, state.account.missing)
  const usable = runnable && status !== 'downloading'
  const ready = readinessOf(state.account, provider, key)
  const cli: StepCheck = copy?.status === 'failed' && copy.source === 'checked' ? 'failed' : runnable ? 'passed' : 'empty'
  const account: StepCheck = ready.state === 'ready' ? 'passed' : ready.state === 'signIn' || ready.state === 'unsupported' ? 'failed' : 'empty'
  const name = t.account.agents[provider]
  const text = cliText()
  return (
    <>
      {copy && (
        <Section title={text.versionOf(name)} mark={<Dot check={cli} first />} className="project-add__step">
          <CliSourceChoice provider={provider} label={text.which} />
        </Section>
      )}
      <Section
        title={text.accountOf(name)}
        mark={<Dot check={account} first={cli === 'passed'} />}
        aside={usable ? <button type="button" className="button" disabled={state.account.login !== null} onClick={() => openAdd(provider)}>+ {t.account.addHere}</button> : undefined}
        className="project-add__step"
      >
        {usable ? <AccountTable state={state} provider={provider} save={save} /> : <p className="setup-agent__who setup-account__note">{status === 'downloading' ? text.accountAfter : text.accountLater}</p>}
      </Section>
    </>
  )
}

/** The provider's accounts as on the accounts page, the one sessions use checked; a click on another's mark picks it. */
function AccountTable({ state, provider, save }: { state: EvenKeelState; provider: Provider; save: Save }) {
  const { send, sending, failure } = useCommand()
  const shared = state.config.shared
  const entries = state.account.accounts.filter((each) => each.agent === provider)
  const busy = state.account.login !== null
  const text = cliText()
  if (entries.length === 0) return <p className="setup-agent__who setup-account__note">{t.setup.noAccount(t.account.agents[provider])}</p>
  return (
    <>
      <table className="setup-accounts">
        <tbody>
          {entries.map((entry) => {
            const name = accountName(entry, state.account.accounts)
            const picked = entry.key === shared.accounts[provider]
            const ready = readinessOf(state.account, provider, entry.key)
            return (
              <tr key={entry.key} className={picked ? 'setup-accounts__row--picked' : undefined}>
                <td className="setup-accounts__mark">
                  <button type="button" className="provider-choice__radio" role="radio" aria-checked={picked} aria-label={name} disabled={picked}
                    onClick={() => void save({ accounts: { ...shared.accounts, [provider]: entry.key } })}>
                    <span className="provider-choice__mark" aria-hidden="true">{picked && <CheckIcon />}</span>
                  </button>
                </td>
                <td className="setup-accounts__name">{name}</td>
                <td className="setup-accounts__state">
                  {ready.state === 'unsupported' && say(copilotNote())}
                  {ready.state === 'signIn' && <>
                    <span>{text.needsSignIn}</span>
                    <button type="button" className="button button--small" disabled={sending || busy} onClick={() => void send('account/renew', { account: entry.key })}>{t.setup.login}</button>
                  </>}
                  {ready.state === 'ready' && entry.status === null && text.checking}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </>
  )
}
