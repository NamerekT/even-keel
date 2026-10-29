import { CLI_SOURCES, PINNED_PROVIDERS } from '../../../src/agent/providers.js'
import { CLAUDE } from '../../../src/claude/name.js'
import type { EvenKeelState } from '../../../src/state.js'
import { PROVIDERS, readinessOf, type Provider } from '../accounts.js'
import { accountName } from '../accountName.js'
import { say, t } from '../i18n/index.js'
import { AgentIcon } from '../layout/accountParts.js'
import { useOpenAdd } from '../layout/AddAccountDialog.js'
import { CliActions, requestCli } from '../layout/CliCopies.js'
import { useCommand } from '../live/useCommand.js'
import { Segmented } from '../stats/common.js'
import { CheckIcon } from '../ui/icons.js'
import { ChosenMark, type Save } from './SetupChoices.js'
import { Row } from './settingsParts.js'
import { copilotNote } from '../../../src/opencode/support.js'
import { providerHint } from '../accountAdd.js'

/**
 * The setup's agent (BTN-346): a card per provider with its own icon and its account inside — signed in, a sign-in to
 * renew or one to add — so a provider without an account reads as a step to take, not an error; then the CLI version.
 */
export function AgentStep({ state, save, sending }: { state: EvenKeelState; save: Save; sending: boolean }) {
  const shared = state.config.shared
  const provider = shared.provider
  const cliHint = CLI_SOURCES.map((each) => `${t.setup.cliSources[each] ?? each}: ${t.setup.cliHints[each]}`).join(' ')
  return (
    <>
      <p className="setup__lead">{t.setup.agentLead}</p>
      <ul className="setup-agents">
        {PROVIDERS.map((each) => (
          <AgentCard key={each} state={state} provider={each} chosen={each === provider} disabled={sending} onPick={async () => {
            if (await save({ provider: each }) && each === provider) {
              const copy = state.cliCopies?.[each]
              if (copy?.source === 'checked' && copy.status !== 'ready') requestCli(each)
            }
          }} />
        ))}
      </ul>
      {PINNED_PROVIDERS.includes(provider) && (
        <Row
          className="setup__row"
          label={t.setup.cli}
          hint={provider === CLAUDE ? `${cliHint} ${t.setup.cliSize}` : cliHint}
          control={
            <Segmented
              label={t.setup.cli}
              options={CLI_SOURCES.map((each): [string, string] => [each, t.setup.cliSources[each] ?? each])}
              value={shared.cli[provider] ?? CLI_SOURCES[0]!}
              onChange={(value) => { void save({ cli: { ...shared.cli, [provider]: value } }) }}
            />
          }
        />
      )}
    </>
  )
}

interface CardProps {
  state: EvenKeelState
  provider: Provider
  chosen: boolean
  disabled: boolean
  onPick: () => void
}

/** The pick is the card's button stretched over it; the account's own button sits above it. */
function AgentCard({ state, provider, chosen, disabled, onPick }: CardProps) {
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
      <div className="setup-agent__account">
        <AccountLine state={state} provider={provider} />
      </div>
    </li>
  )
}

/** The account of the provider's pool entry: its name with a check, or the one button that makes it so. */
function AccountLine({ state, provider }: { state: EvenKeelState; provider: Provider }) {
  const openAdd = useOpenAdd()
  const copy = state.cliCopies?.[provider]
  if (copy && (copy.source === 'checked' && copy.status !== 'ready' || copy.source === 'system' && !copy.system)) return <CliActions provider={provider} onDownload={() => openAdd(provider)} />
  return <>
    {copy?.status === 'failed' && <CliActions provider={provider} onDownload={() => openAdd(provider)} />}
    <ReadyAccountLine state={state} provider={provider} />
  </>
}

function ReadyAccountLine({ state, provider }: { state: EvenKeelState; provider: Provider }) {
  const { send, sending, failure } = useCommand()
  const openAdd = useOpenAdd()
  const ready = readinessOf(state.account, provider, state.config.shared.accounts[provider] ?? '')
  const busy = state.account.login !== null
  if (ready.state === 'cliMissing') return <span className="tag">{t.account.cliNotFound}</span>
  if (ready.state === 'noAccount')
    return (
      <button type="button" className="button button--small" disabled={busy} onClick={() => openAdd(provider)}>
        {t.setup.addAccount}
      </button>
    )
  const name = accountName(ready.entry, state.account.accounts)
  if (ready.state === 'unsupported') return <>
    <span className="setup-agent__who">{name}: {say(copilotNote())}</span>
    <button type="button" className="button button--small" disabled={busy} onClick={() => openAdd(provider)}>{t.setup.addAccount}</button>
  </>
  if (ready.state === 'signIn')
    return (
      <>
        <span className="setup-agent__who">{t.setup.signIn(name)}</span>
        <button type="button" className="button button--small" disabled={sending || busy} onClick={() => void send('account/renew', { account: ready.entry.key })}>
          {t.setup.login}
        </button>
        {failure !== null && <span className="settings__error">{say(failure)}</span>}
      </>
    )
  if (ready.entry.status === null) return <span className="setup-agent__who">{t.setup.checking(name)}</span>
  return (
    <span className="setup-agent__who setup-agent__who--ok">
      <CheckIcon />
      {name}
    </span>
  )
}
