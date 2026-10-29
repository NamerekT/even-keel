import type { EvenKeelState } from '../../../src/state.js'
import { PROVIDERS, readinessOf } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { accountName } from '../accountName.js'
import { useOpenAdd } from '../layout/AddAccountDialog.js'
import { CliActions } from '../layout/CliCopies.js'
import { useCommand } from '../live/useCommand.js'
import { providerName } from './settingsRun.js'
import { Status } from './TrackerFields.js'
import { CommandBlock } from '../ui/blocks.js'
import { INSTALL } from '../layout/cliText.js'
import type { StepCheck } from './wizard.js'

/** The agent step's dot: green once the account is signed in and seen, red while it cannot run, empty while it is read. */
export function agentCheck(state: EvenKeelState, provider: string): StepCheck {
  const copy = state.cliCopies?.[provider]
  if (copy?.source === 'checked' && copy.status !== 'ready') return 'empty'
  const ready = readinessOf(state.account, provider, state.config.shared.accounts[provider] ?? '')
  if (ready.state !== 'ready') return 'failed'
  return ready.entry.status === null ? 'empty' : 'passed'
}

/**
 * Whether the provider can run sessions now (BTN-310): its CLI, the account folder of its shared pool entry and that
 * folder's sign-in. "Sign in" opens the page's sign-in dialog in place, "Add an account" the add dialog over the page (BTN-352).
 */
export function AgentReady({ state, provider }: { state: EvenKeelState; provider: string }) {
  const openAdd = useOpenAdd()
  const known = PROVIDERS.find((each) => each === provider)
  const copy = state.cliCopies?.[provider]
  const actions = <CliActions provider={provider} onDownload={() => { if (known) openAdd(known) }} />
  if (copy && (copy.source === 'checked' && copy.status !== 'ready' || copy.source === 'system' && !copy.system)) return actions
  return <>{copy?.status === 'failed' && actions}<Ready state={state} provider={provider} /></>
}

function Ready({ state, provider }: { state: EvenKeelState; provider: string }) {
  const { send, sending, failure } = useCommand()
  const openAdd = useOpenAdd()
  const known = PROVIDERS.find((each) => each === provider)
  const ready = readinessOf(state.account, provider, state.config.shared.accounts[provider] ?? '')
  if (ready.state === 'cliMissing') return <Status>{t.account.cliNotFound}{known !== undefined && <CommandBlock command={INSTALL[known]!} />}</Status>
  if (ready.state === 'noAccount')
    return (
      <Status>
        {t.setup.noAccount(providerName(provider))}{' '}
        {known !== undefined && (
          <button type="button" className="button button--small" disabled={state.account.login !== null} onClick={() => openAdd(known)}>
            {t.setup.addAccount}
          </button>
        )}
      </Status>
    )
  const name = accountName(ready.entry, state.account.accounts)
  if (ready.state === 'signIn')
    return (
      <>
        <Status>
          {t.setup.signIn(name)}{' '}
          <button
            type="button"
            className="button button--small"
            disabled={sending || state.account.login !== null}
            onClick={() => void send('account/renew', { account: ready.entry.key })}
          >
            {t.setup.login}
          </button>
        </Status>
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </>
    )
  if (ready.entry.status === null) return <span className="settings__hint">{t.setup.checking(name)}</span>
  return <Status ok>{t.setup.ready(name)}</Status>
}
