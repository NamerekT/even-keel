import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import type { AccountLogin, AccountView, LoginBlock } from '../../../src/account/model.js'
import { useCommand } from '../live/useCommand.js'
import { accountBadge } from '../state.js'
import { usePopover } from './usePopover.js'

const AUTH_METHODS: Record<string, string> = {
  'claude.ai': 'подписка Claude',
  console: 'Anthropic Console',
}

export function AccountMenu({ account }: { account: AccountView }) {
  const { open, setOpen, rootRef } = usePopover()
  const badge = accountBadge(account)

  return (
    <div className="queue-menu" ref={rootRef}>
      <button
        type="button"
        className={`queue-toggle account-toggle account-toggle--${badge.kind}`}
        aria-expanded={open}
        aria-controls="account-panel"
        title={account.status?.email ?? 'Аккаунт Claude'}
        onClick={() => setOpen(!open)}
      >
        <span className="queue-toggle__dot" aria-hidden="true" />
        <span className="account-toggle__label">{badge.label}</span>
      </button>
      {open && <AccountPanel account={account} />}
    </div>
  )
}

function AccountPanel({ account }: { account: AccountView }) {
  const { send, sending, failure } = useCommand()
  const { status, login } = account

  return (
    <div id="account-panel" className="queue" role="dialog" aria-label="Аккаунт Claude">
      <section className="queue__section">
        <h2 className="queue__heading">Аккаунт Claude</h2>
        {status === null ? (
          <p className="queue__empty">Статус ещё не получен.</p>
        ) : status.loggedIn ? (
          <dl className="account__facts">
            <dt>Почта</dt>
            <dd>{status.email ?? '—'}</dd>
            {status.orgName !== null && (
              <>
                <dt>Организация</dt>
                <dd>{status.orgName}</dd>
              </>
            )}
            {status.subscriptionType !== null && (
              <>
                <dt>План</dt>
                <dd>{status.subscriptionType}</dd>
              </>
            )}
            {status.authMethod !== null && (
              <>
                <dt>Вход</dt>
                <dd>{AUTH_METHODS[status.authMethod] ?? status.authMethod}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="notice notice--error">Диспетчер не вошёл в Claude — сессии не запускаются.</p>
        )}
        {account.error !== null && <p className="queue__hint">Последняя проверка не удалась: {account.error}</p>}
      </section>

      <section className="queue__section">
        <h2 className="queue__heading">{status?.loggedIn ? 'Сменить аккаунт' : 'Войти'}</h2>
        {login === null ? (
          <>
            {account.loginBlock === null ? (
              <p className="queue__hint">Claude выдаст ссылку для входа: откройте её здесь же и войдите нужным аккаунтом.</p>
            ) : (
              <Blockers block={account.loginBlock} />
            )}
            <div className="account__actions">
              <button
                type="button"
                className="button button--primary"
                disabled={sending || account.loginBlock !== null}
                onClick={() => void send('account/login')}
              >
                {status?.loggedIn ? 'Войти другим аккаунтом' : 'Войти'}
              </button>
            </div>
          </>
        ) : (
          <LoginSteps login={login} sending={sending} send={send} />
        )}
      </section>

      {failure !== null && <p className="notice notice--error queue__error">{failure}</p>}
    </div>
  )
}

function Blockers({ block }: { block: LoginBlock }) {
  return (
    <div className="account__blockers">
      <p className="queue__hint">Сменить пока нельзя, мешает:</p>
      <ul className="account__blocker-list">
        {block.chain !== null && (
          <li>
            Цепочка <Link to={`/p/${block.chain}`}>{block.chain}</Link> идёт — поставьте её на паузу.
          </li>
        )}
        {block.sessions.map((session, index) => (
          <li key={`${session.name}-${index}`}>
            <span className="account__blocker-name">{session.name}</span>{' '}
            {session.status === 'busy' ? 'работает' : `ждёт ответа${session.waitingFor === null ? '' : `: ${session.waitingFor}`}`}
          </li>
        ))}
      </ul>
      {block.sessions.length > 0 && (
        <p className="queue__hint">Сессия перестаёт мешать, как только заканчивает ход.</p>
      )}
    </div>
  )
}

interface StepsProps {
  login: AccountLogin
  sending: boolean
  send: (name: string, body?: Record<string, unknown>) => Promise<boolean>
}

function LoginSteps({ login, sending, send }: StepsProps) {
  const [code, setCode] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await send('account/code', { code })) setCode('')
  }

  if (login.error !== null) {
    return (
      <>
        <p className="notice notice--error">{login.error}</p>
        <div className="account__actions">
          <button type="button" className="button button--primary" disabled={sending} onClick={() => void send('account/login')}>
            Повторить
          </button>
          <button type="button" className="button" disabled={sending} onClick={() => void send('account/cancel')}>
            Закрыть
          </button>
        </div>
        {login.output !== '' && <Output text={login.output} />}
      </>
    )
  }

  return (
    <>
      {login.urls.length === 0 ? (
        <p className="queue__hint">Жду ссылку для входа от claude…</p>
      ) : (
        <ul className="account__links">
          {login.urls.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                {login.urls.length === 1 ? 'Открыть страницу входа' : new URL(url).host}
              </a>
            </li>
          ))}
        </ul>
      )}
      <form className="account__code" onSubmit={(event) => void submit(event)}>
        <input
          className="account__input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Код со страницы входа"
          aria-label="Код со страницы входа"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="button" disabled={sending || code.trim() === ''}>
          Отправить
        </button>
      </form>
      <p className="queue__hint">
        {login.codeSent ? 'Код отправлен, жду подтверждения.' : 'Код нужен, только если страница входа его показала.'}
      </p>
      <div className="account__actions">
        <button type="button" className="button" disabled={sending} onClick={() => void send('account/cancel')}>
          Отменить вход
        </button>
      </div>
      {login.output !== '' && <Output text={login.output} />}
    </>
  )
}

function Output({ text }: { text: string }) {
  return (
    <details className="account__output">
      <summary>Вывод claude</summary>
      <pre>{text}</pre>
    </details>
  )
}
