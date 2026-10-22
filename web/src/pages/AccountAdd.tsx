import { useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { AccountView } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { NO_SIGN_IN, SIGN_INS } from '../../../src/agent/providers.js'
import { CODEX } from '../../../src/codex/name.js'
import { COPILOT } from '../../../src/copilot/name.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import type { EvenKeelState } from '../../../src/state.js'
import { addStep, canAdd, cliMissing, CONNECTIONS, deviceLogin, PROVIDERS, type Connection, type Provider } from '../accounts.js'
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
  const step = addStep(search)
  const { provider } = step
  const open = provider !== null && canAdd(provider) && !cliMissing(state.account, provider)
  const connection = open ? step.connection : null
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
        <li aria-current={!open ? 'step' : undefined}>
          {provider === null ? t.account.stepProvider : `${t.account.stepProvider}: ${t.account.agents[provider]}`}
        </li>
        <li aria-current={open && connection === null ? 'step' : undefined}>
          {connection === null ? t.account.stepConnection : `${t.account.stepConnection}: ${t.account.connections[connection]}`}
        </li>
        <li aria-current={connection !== null ? 'step' : undefined}>{t.account.stepSignIn}</li>
      </ol>
      {!open ? (
        <Choices items={PROVIDERS.map((each) => providerChoice(state.account, each))} />
      ) : connection === null ? (
        <Choices
          items={CONNECTIONS.map((each) => ({
            id: each,
            title: t.account.connections[each],
            hint: canAdd(provider, each) ? (provider === 'copilot' ? t.account.copilotConnectionHints : t.account.connectionHints)[each] : each === 'sdk' ? t.account.sdkStub : t.account.soon,
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

interface Choice {
  id: string
  title: string
  hint: string
  ready: boolean
  to: string
  /** The tag of a choice that is not ready; "not yet" unless given. */
  tag?: string
}

const MISSING = { claude: 'login.claudeMissing', codex: 'login.codexMissing', opencode: 'login.opencodeMissing', copilot: 'login.copilotMissing' } as const

/** A provider whose CLI the service does not find is off, its hint saying where to get the CLI. */
function providerChoice(account: AccountView, provider: Provider): Choice {
  const base = { id: provider, title: t.account.agents[provider], to: `${ADD}?provider=${provider}` }
  if (canAdd(provider) && cliMissing(account, provider)) {
    const missing = say({ code: MISSING[provider], params: {} })
    return { ...base, hint: missing, ready: false, tag: t.account.cliNotFound }
  }
  return { ...base, hint: t.account.providerHints[provider], ready: canAdd(provider) }
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
                {item.title} <span className="tag">{item.tag ?? t.account.soon}</span>
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

const KEY_HINTS: Record<Provider, string> = {
  claude: t.account.keyHint,
  codex: t.account.codexKeyHint,
  opencode: t.account.opencodeKeyHint,
  copilot: t.account.copilotKeyHint,
}

function SignIn({ account, provider, connection, onDone, onCancel }: SignInProps) {
  if (connection === 'apiKey') return <ApiKeyFields agent={provider} hint={KEY_HINTS[provider]} onDone={onDone} onCancel={onCancel} />
  if (provider === 'opencode') return <OpenCodeSignIn account={account} onDone={onDone} />
  if (provider === 'copilot') return <CopilotSignIn onDone={onDone} />
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

/** Back to the list once the running sign-in has come and gone. */
function useLoginDone(login: AccountView['login'], onDone: () => void): void {
  const seen = useRef(false)
  useEffect(() => {
    if (login !== null) seen.current = true
    else if (seen.current) onDone()
  }, [login, onDone])
}

/** A sign-in through the agent's CLI: the button starts it, then the link and the code; once it ends — the list. */
function CliSignIn({ account, hint, start, onDone }: CliProps) {
  const { send, sending, failure } = useCommand()
  const { login } = account
  useLoginDone(login, onDone)

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

/** OpenCode signs in to the provider picked here; its free models need no sign-in, so that folder is added at once. */
function OpenCodeSignIn({ account, onDone }: { account: AccountView; onDone: () => void }) {
  const { send, sending, failure } = useCommand()
  const { login } = account
  useLoginDone(login, onDone)

  if (login !== null) return <LoginSteps login={login} device={deviceLogin(account)} sending={sending} send={send} />
  const start = async (method: string) => {
    if ((await send('account/add', { agent: OPENCODE, method })) && method === NO_SIGN_IN) onDone()
  }
  return (
    <>
      <p className="queue__hint">{t.account.opencodeHint}</p>
      <div className="account__actions">
        {SIGN_INS[OPENCODE]!.map((method) => (
          <button key={method} type="button" className="button button--primary" disabled={sending} onClick={() => void start(method)}>
            {t.account.opencodeMethods[method as keyof typeof t.account.opencodeMethods] ?? method}
          </button>
        ))}
      </div>
      <p className="queue__hint">{t.account.opencodeClaude}</p>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </>
  )
}

/**
 * A Copilot folder without a token runs on the CLI's own sign-in of the machine, which Even Keel does not drive: the
 * folder is added at once. Another GitHub account comes as a token (`apiKey`).
 */
function CopilotSignIn({ onDone }: { onDone: () => void }) {
  const { send, sending, failure } = useCommand()
  const add = async () => {
    if (await send('account/add', { agent: COPILOT, method: NO_SIGN_IN })) onDone()
  }
  return (
    <>
      <p className="queue__hint">{t.account.copilotHint}</p>
      <div className="account__actions">
        <button type="button" className="button button--primary" disabled={sending} onClick={() => void add()}>
          {t.account.copilotAdd}
        </button>
      </div>
      <p className="queue__hint">{t.account.copilotFree}</p>
      {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
    </>
  )
}
