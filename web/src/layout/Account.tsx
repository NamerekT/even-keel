import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import {
  removeProblem,
  switchProblem,
  type AccountEntry,
  type AccountLogin,
  type AccountView,
  type LoginBlock,
} from '../../../src/account/model.js'
import { useCommand } from '../live/useCommand.js'
import { accountBadge, loginLeft } from '../state.js'
import { Limits } from './Limits.js'
import { useNow } from './useNow.js'
import { usePopover } from './usePopover.js'

type Send = (name: string, body?: Record<string, unknown>) => Promise<boolean>

export function AccountMenu({ account }: { account: AccountView }) {
  const { open, setOpen, rootRef } = usePopover()
  const badge = accountBadge(account)
  const active = account.accounts.find((entry) => entry.key === account.active)

  return (
    <div className="queue-menu" ref={rootRef}>
      <button
        type="button"
        className={`queue-toggle account-toggle account-toggle--${badge.kind}`}
        aria-expanded={open}
        aria-controls="account-panel"
        title={active?.status?.email ?? 'Аккаунт Claude'}
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
  const now = useNow(60_000)
  const { login } = account

  return (
    <div id="account-panel" className="queue" role="dialog" aria-label="Аккаунты Claude">
      <section className="queue__section">
        <h2 className="queue__heading">Аккаунты Claude</h2>
        {account.accounts.length === 0 ? (
          <p className="queue__empty">Список ещё не получен.</p>
        ) : (
          <ul className="accounts">
            {account.accounts.map((entry) => (
              <AccountItem key={entry.key} entry={entry} view={account} now={now} sending={sending} send={send} />
            ))}
          </ul>
        )}
        {account.loginBlock !== null && <Blockers block={account.loginBlock} />}
      </section>

      <section className="queue__section">
        <h2 className="queue__heading">{loginHeading(account)}</h2>
        {login === null ? (
          <>
            <p className="queue__hint">
              Вход в новой папке: активный аккаунт не меняется. Claude выдаст ссылку — откройте её и войдите нужным аккаунтом.
            </p>
            <div className="account__actions">
              <button type="button" className="button" disabled={sending} onClick={() => void send('account/add')}>
                Добавить аккаунт
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

function loginHeading({ login, accounts }: AccountView): string {
  if (login === null) return 'Добавить аккаунт'
  if (login.target === null) return 'Вход в новый аккаунт'
  const target = accounts.find((entry) => entry.key === login.target)
  return `Вход: ${target?.status?.email ?? login.target}`
}

interface ItemProps {
  entry: AccountEntry
  view: AccountView
  now: Date
  sending: boolean
  send: Send
}

function AccountItem({ entry, view, now, sending, send }: ItemProps) {
  const [confirming, setConfirming] = useState(false)
  const active = entry.key === view.active
  const left = loginLeft(entry.loginExpiresAt, now)
  const blocked = switchProblem(view, entry.key)
  const removable = removeProblem(view, entry.key) === undefined
  const renewBlocked = view.login !== null || (active && view.loginBlock !== null)
  const email = entry.status?.email ?? (entry.global ? 'глобальный ~/.claude' : entry.key)

  return (
    <li className={`accounts__item${active ? ' accounts__item--active' : ''}`}>
      <div className="accounts__head">
        <span className="accounts__email">{email}</span>
        {active && <span className="accounts__mark accounts__mark--active">активен</span>}
        {entry.needsLogin && <span className="accounts__mark accounts__mark--login">нужен вход</span>}
      </div>
      <div className="accounts__facts">
        {entry.status?.subscriptionType != null && <span>план {entry.status.subscriptionType}</span>}
        <span className={left.renew ? 'accounts__expiry accounts__expiry--soon' : 'accounts__expiry'}>вход: {left.text}</span>
        {entry.sessions > 0 && <span>сессий: {entry.sessions}</span>}
        {entry.global && <span>папка ~/.claude</span>}
      </div>
      {entry.limits === null ? (
        <p className="accounts__no-limits">Лимиты: нет данных{entry.usage.state === 'stale' ? ' — токен доступа истёк, обновит первая сессия' : ''}</p>
      ) : (
        <Limits limits={entry.limits} now={now} />
      )}
      {entry.error !== null && <p className="queue__hint">Последняя проверка не удалась: {entry.error}</p>}
      <div className="account__actions">
        {!active && (
          <button
            type="button"
            className="button button--primary"
            disabled={sending || blocked !== undefined}
            title={blocked}
            onClick={() => void send('account/switch', { account: entry.key })}
          >
            Переключить
          </button>
        )}
        {(left.renew || entry.needsLogin) && (
          <button
            type="button"
            className="button"
            disabled={sending || renewBlocked}
            onClick={() => void send('account/renew', { account: entry.key })}
          >
            {entry.needsLogin ? 'Войти' : 'Продлить вход'}
          </button>
        )}
        {removable && !confirming && (
          <button type="button" className="button" disabled={sending} onClick={() => setConfirming(true)}>
            Удалить
          </button>
        )}
        {removable && confirming && (
          <>
            <span className="accounts__confirm">Выйти и удалить папку?</span>
            <button
              type="button"
              className="button button--danger"
              disabled={sending}
              onClick={() => void send('account/remove', { account: entry.key }).then(() => setConfirming(false))}
            >
              Удалить
            </button>
            <button type="button" className="button" disabled={sending} onClick={() => setConfirming(false)}>
              Отмена
            </button>
          </>
        )}
      </div>
    </li>
  )
}

function Blockers({ block }: { block: LoginBlock }) {
  return (
    <div className="account__blockers">
      <p className="queue__hint">Переключить пока нельзя, мешает:</p>
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
  send: Send
}

function LoginSteps({ login, sending, send }: StepsProps) {
  const [code, setCode] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await send('account/code', { code })) setCode('')
  }

  if (login.error !== null) {
    const retry = () => (login.target === null ? send('account/add') : send('account/renew', { account: login.target }))
    return (
      <>
        <p className="notice notice--error">{login.error}</p>
        <div className="account__actions">
          <button type="button" className="button button--primary" disabled={sending} onClick={() => void retry()}>
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
