import { useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { AccountView } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { CODEX } from '../../../src/codex/name.js'
import type { EvenKeelState } from '../../../src/state.js'
import { addStep, canAdd, CONNECTIONS, deviceLogin, PROVIDERS, type Connection, type Provider } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { ApiKeyFields, LoginSteps } from '../layout/accountParts.js'
import './accounts.css'

const LIST = '/accounts'
const ADD = '/accounts/add'

/** Adding an account: the provider, then how it signs in, then that way's own sign-in; done, it goes back to the list. */
export function AccountAddPage({ state }: { state: EvenKeelState }) {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { provider, connection } = addStep(search)
  const toList = () => void navigate(LIST)
  const back = connection !== null ? `${ADD}?provider=${provider}` : provider !== null ? ADD : LIST

  return (
    <div className="page accounts-page">
      <header className="accounts-page__head">
        <h1 className="page__title">{t.account.add}</h1>
        <Link to={back} className="button">
          ← {t.account.back}
        </Link>
      </header>
      <ol className="add-steps">
        <li aria-current={provider === null || !canAdd(provider) ? 'step' : undefined}>
          {provider === null ? t.account.stepProvider : `${t.account.stepProvider}: ${t.account.agents[provider]}`}
        </li>
        <li aria-current={provider !== null && canAdd(provider) && connection === null ? 'step' : undefined}>
          {connection === null ? t.account.stepConnection : `${t.account.stepConnection}: ${t.account.connections[connection]}`}
        </li>
        <li aria-current={connection !== null ? 'step' : undefined}>{t.account.stepSignIn}</li>
      </ol>
      {provider === null || !canAdd(provider) ? (
        <Choices
          items={PROVIDERS.map((each) => ({ id: each, title: t.account.agents[each], hint: t.account.providerHints[each], ready: canAdd(each), to: `${ADD}?provider=${each}` }))}
        />
      ) : connection === null ? (
        <Choices
          items={CONNECTIONS.map((each) => ({
            id: each,
            title: t.account.connections[each],
            hint: canAdd(provider, each) ? t.account.connectionHints[each] : stubHint(provider, each),
            ready: canAdd(provider, each),
            to: `${ADD}?provider=${provider}&connection=${each}`,
          }))}
        />
      ) : (
        <section className="add-window">
          <SignIn account={state.account} provider={provider} connection={connection} onDone={toList} onCancel={() => void navigate(back)} />
        </section>
      )}
    </div>
  )
}

function stubHint(provider: Provider, connection: Connection): string {
  return connection === 'sdk' ? t.account.sdkStub : provider === 'codex' && connection === 'apiKey' ? t.account.codexKeyStub : t.account.soon
}

interface Choice {
  id: string
  title: string
  hint: string
  ready: boolean
  to: string
}

function Choices({ items }: { items: Choice[] }) {
  return (
    <ul className="add-choices">
      {items.map((item) => (
        <li key={item.id}>
          {item.ready ? (
            <Link to={item.to} className="add-choice">
              <span className="add-choice__title">{item.title}</span>
              <span className="add-choice__hint">{item.hint}</span>
            </Link>
          ) : (
            <div className="add-choice add-choice--off" aria-disabled="true">
              <span className="add-choice__title">
                {item.title} <span className="tag">{t.account.soon}</span>
              </span>
              <span className="add-choice__hint">{item.hint}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

interface SignInProps {
  account: AccountView
  provider: Provider
  connection: Connection
  onDone: () => void
  onCancel: () => void
}

function SignIn({ account, provider, connection, onDone, onCancel }: SignInProps) {
  if (connection === 'apiKey') return <ApiKeyFields onDone={onDone} onCancel={onCancel} />
  if (provider === 'codex') {
    return (
      <>
        <CliSignIn account={account} hint={t.account.codexHint} start={['account/add', { agent: CODEX }]} onDone={onDone} />
        {account.login === null && <p className="queue__hint">{t.account.codexFree}</p>}
      </>
    )
  }
  return <CliSignIn account={account} hint={t.account.addHint} start={['account/add', { agent: CLAUDE }]} onDone={onDone} />
}

interface CliProps {
  account: AccountView
  hint: string
  start: [string, Record<string, unknown>]
  onDone: () => void
}

/** A sign-in through the agent's CLI: the button starts it, then the link and the code; once it ends — the list. */
function CliSignIn({ account, hint, start, onDone }: CliProps) {
  const { send, sending, failure } = useCommand()
  const { login } = account
  const seen = useRef(false)

  useEffect(() => {
    if (login !== null) seen.current = true
    else if (seen.current) onDone()
  }, [login, onDone])

  if (login !== null) return <LoginSteps login={login} device={deviceLogin(account)} sending={sending} send={send} />
  return (
    <>
      <p className="queue__hint">{hint}</p>
      <div className="account__actions">
        <button type="button" className="button button--primary" disabled={sending} onClick={() => void send(...start)}>
          {t.account.login}
        </button>
      </div>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </>
  )
}
