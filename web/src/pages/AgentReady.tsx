import { Link } from 'react-router'
import type { EvenKeelState } from '../../../src/state.js'
import { addPath, PROVIDERS, readinessOf } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { accountName } from '../layout/accountParts.js'
import { useCommand } from '../live/useCommand.js'
import { CLI_MISSING } from './AccountAdd.js'
import { providerName } from './settingsRun.js'
import { Status } from './TrackerFields.js'

/**
 * Whether the provider can run sessions now (BTN-310): its CLI, the account folder of its shared pool entry and that
 * folder's sign-in. "Sign in" opens the page's sign-in dialog in place; "Add an account" comes back to `back`.
 */
export function AgentReady({ state, provider, back }: { state: EvenKeelState; provider: string; back: string }) {
  const { send, sending, failure } = useCommand()
  const known = PROVIDERS.find((each) => each === provider)
  const ready = readinessOf(state.account, provider, state.config.shared.accounts[provider] ?? '')
  if (ready.state === 'cliMissing') return <Status>{known === undefined ? provider : say({ code: CLI_MISSING[known], params: {} })}</Status>
  if (ready.state === 'noAccount')
    return (
      <Status>
        {t.setup.noAccount(providerName(provider))}{' '}
        {known !== undefined && (
          <Link to={addPath(back, known)} className="button button--small">
            {t.setup.addAccount}
          </Link>
        )}
      </Status>
    )
  const name = accountName(ready.entry)
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
