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
import { APP_LABELS, appSwitchProblem, type AppAccount } from '../../../src/account/apps.js'
import type { AgentStatus } from '../../../src/sessions/agents.js'
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
      {open && <AccountPanel account={account} onClose={() => setOpen(false)} />}
    </div>
  )
}

function AccountPanel({ account, onClose }: { account: AccountView; onClose: () => void }) {
  const { send, sending, failure } = useCommand()
  const now = useNow(60_000)
  const { login } = account

  return (
    <aside id="account-panel" className="drawer" role="dialog" aria-label="Аккаунты Claude">
      <div className="drawer__head">
        <h2 className="drawer__title">Аккаунты Claude</h2>
        <button type="button" className="panel__close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
      </div>

      <section className="queue__section">
        <h2 className="queue__heading">Приложения</h2>
        <ul className="accounts">
          {account.apps.map((app) => (
            <AppItem key={app.app} app={app} view={account} sending={sending} send={send} />
          ))}
        </ul>
      </section>

      <section className="queue__section">
        <h2 className="queue__heading">Папки аккаунтов</h2>
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
    </aside>
  )
}

const CHAT_STATUS: Record<AgentStatus, string> = { busy: 'работает', waiting: 'ждёт ответа', idle: 'открыт' }

interface AppProps {
  app: AppAccount
  view: AccountView
  sending: boolean
  send: Send
}

function AppItem({ app, view, sending, send }: AppProps) {
  const label = APP_LABELS[app.app]
  const current = view.accounts.find((entry) => entry.key === app.account)
  const targets = view.accounts.filter((entry) => entry.key !== app.account && entry.status?.loggedIn === true)

  return (
    <li className="accounts__item">
      <div className="accounts__head">
        <span className="accounts__email">{label}</span>
        <span className="accounts__app-account">{appAccountName(app, current)}</span>
      </div>
      {app.error !== null && <p className="notice notice--error">{app.error}</p>}
      {app.sessions.length > 0 && (
        <div className="account__blockers">
          <p className="queue__hint">Переключить пока нельзя, открыты чаты Claude:</p>
          <ul className="account__blocker-list">
            {app.sessions.map((session, index) => (
              <li key={`${session.name}-${index}`}>
                <span className="account__blocker-name">{session.name}</span> {session.status === null ? 'открыт' : CHAT_STATUS[session.status]}
              </li>
            ))}
          </ul>
          <p className="queue__hint">Закройте их в {label} — панель обновится сама.</p>
        </div>
      )}
      {app.error === null && targets.length > 0 && (
        <div className="account__actions">
          {targets.map((entry) => {
            const blocked = appSwitchProblem(view, app.app, entry.key)
            return (
              <button
                key={entry.key}
                type="button"
                className="button"
                disabled={sending || blocked !== undefined}
                title={blocked}
                onClick={() => void send('account/app', { app: app.app, account: entry.key })}
              >
                → {entry.status?.email ?? entry.key}
              </button>
            )
          })}
        </div>
      )}
      <p className="queue__hint">Новый аккаунт {label} берёт после Developer: Reload Window.</p>
    </li>
  )
}

function appAccountName(app: AppAccount, current: AccountEntry | undefined): string {
  if (current !== undefined) return current.status?.email ?? current.key
  if (app.dir !== null) return `папка ${app.dir} — её нет среди аккаунтов`
  return app.error === null ? 'не прочитан' : '—'
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
  const removable = removeProblem(view, entry.key) === undefined && !entry.removing
  const renewBlocked = view.login !== null || (active && view.loginBlock !== null)
  const email = entry.status?.email ?? (entry.global ? 'глобальный ~/.claude' : entry.key)

  return (
    <li className={`accounts__item${active ? ' accounts__item--active' : ''}`}>
      <div className="accounts__head">
        <span className="accounts__email">{email}</span>
        {active && <span className="accounts__mark accounts__mark--active">Even Keel</span>}
        {view.apps
          .filter((app) => app.account === entry.key)
          .map((app) => (
            <span key={app.app} className="accounts__mark">
              {APP_LABELS[app.app]}
            </span>
          ))}
        {entry.needsLogin && <span className="accounts__mark accounts__mark--login">нужен вход</span>}
      </div>
      <div className="accounts__facts">
        {entry.status?.subscriptionType != null && <span>план {entry.status.subscriptionType}</span>}
        <span className={left.renew ? 'accounts__expiry accounts__expiry--soon' : 'accounts__expiry'}>вход: {left.text}</span>
        {entry.sessions.length > 0 && <span>сессий: {entry.sessions.length}</span>}
        {entry.global && <span>папка ~/.claude</span>}
      </div>
      {entry.limits === null ? (
        <p className="accounts__no-limits">Лимиты: нет данных{entry.usage.state === 'stale' ? staleNote(entry.usage.reason) : ''}</p>
      ) : (
        <Limits limits={entry.limits} now={now} />
      )}
      {entry.configPending && <p className="queue__hint">Новая общая конфигурация дойдёт до сессий, когда завершатся текущие сессии этого аккаунта</p>}
      {entry.removing && (
        <p className="queue__hint">
          Выйду и удалю папку, когда завершатся процессы сессий этого аккаунта
          {entry.sessions.length > 0 ? `, ещё живы: ${entry.sessions.join(', ')}` : ''}
        </p>
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
            Отдать Even Keel
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
            <span className="accounts__confirm">
              {entry.sessions.length > 0
                ? `Выйти и удалить папку, когда завершатся её сессии (${entry.sessions.join(', ')})?`
                : 'Выйти и удалить папку?'}
            </span>
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
        {entry.removing && (
          <button type="button" className="button" disabled={sending} onClick={() => void send('account/keep', { account: entry.key })}>
            Не удалять
          </button>
        )}
      </div>
    </li>
  )
}

function staleNote(reason: string | null): string {
  return reason === null ? ' — токен доступа истёк, обновит первая сессия' : ' — сервис лимитов сейчас не отвечает, придут из первой сессии'
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
