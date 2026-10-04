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
import { t } from '../i18n/index.js'
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
        title={active?.status?.email ?? t.account.button}
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
    <aside id="account-panel" className="drawer" role="dialog" aria-label={t.account.title}>
      <div className="drawer__head">
        <h2 className="drawer__title">{t.account.title}</h2>
        <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
          ×
        </button>
      </div>

      <section className="queue__section">
        <h2 className="queue__heading">{t.account.apps}</h2>
        <ul className="accounts">
          {account.apps.map((app) => (
            <AppItem key={app.app} app={app} view={account} sending={sending} send={send} />
          ))}
        </ul>
      </section>

      <section className="queue__section">
        <h2 className="queue__heading">{t.account.folders}</h2>
        {account.accounts.length === 0 ? (
          <p className="queue__empty">{t.account.notLoaded}</p>
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
            <p className="queue__hint">{t.account.addHint}</p>
            <div className="account__actions">
              <button type="button" className="button" disabled={sending} onClick={() => void send('account/add')}>
                {t.account.add}
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
          <p className="queue__hint">{t.account.chatsBlock}</p>
          <ul className="account__blocker-list">
            {app.sessions.map((session, index) => (
              <li key={`${session.name}-${index}`}>
                <span className="account__blocker-name">{session.name}</span> {t.account.chats[session.status ?? 'idle']}
              </li>
            ))}
          </ul>
          <p className="queue__hint">{t.account.closeChats(label)}</p>
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
      <p className="queue__hint">{t.account.reload(label)}</p>
    </li>
  )
}

function appAccountName(app: AppAccount, current: AccountEntry | undefined): string {
  if (current !== undefined) return current.status?.email ?? current.key
  if (app.dir !== null) return t.account.unknownDir(app.dir)
  return app.error === null ? t.account.unread : '—'
}

function loginHeading({ login, accounts }: AccountView): string {
  if (login === null) return t.account.add
  if (login.target === null) return t.account.loginNew
  const target = accounts.find((entry) => entry.key === login.target)
  return t.account.loginTo(target?.status?.email ?? login.target)
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
  const email = entry.status?.email ?? (entry.global ? t.account.global : entry.key)

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
        {entry.needsLogin && <span className="accounts__mark accounts__mark--login">{t.account.needsLoginMark}</span>}
      </div>
      <div className="accounts__facts">
        {entry.status?.subscriptionType != null && <span>{t.account.plan(entry.status.subscriptionType)}</span>}
        <span className={left.renew ? 'accounts__expiry accounts__expiry--soon' : 'accounts__expiry'}>{t.account.expiry(left.text)}</span>
        {entry.sessions.length > 0 && <span>{t.account.sessions(entry.sessions.length)}</span>}
        {entry.global && <span>{t.account.globalFolder}</span>}
      </div>
      {entry.limits === null ? (
        <p className="accounts__no-limits">
          {t.account.noLimits}
          {entry.usage.state === 'stale' ? staleNote(entry.usage.reason) : ''}
        </p>
      ) : (
        <Limits limits={entry.limits} now={now} />
      )}
      {entry.configPending && <p className="queue__hint">{t.account.configPending}</p>}
      {entry.removing && (
        <p className="queue__hint">
          {t.account.removing}
          {entry.sessions.length > 0 ? t.account.removingAlive(entry.sessions.join(', ')) : ''}
        </p>
      )}
      {entry.error !== null && <p className="queue__hint">{t.account.checkFailed(entry.error)}</p>}
      <div className="account__actions">
        {!active && (
          <button
            type="button"
            className="button button--primary"
            disabled={sending || blocked !== undefined}
            title={blocked}
            onClick={() => void send('account/switch', { account: entry.key })}
          >
            {t.account.give}
          </button>
        )}
        {(left.renew || entry.needsLogin) && (
          <button
            type="button"
            className="button"
            disabled={sending || renewBlocked}
            onClick={() => void send('account/renew', { account: entry.key })}
          >
            {entry.needsLogin ? t.account.login : t.account.renew}
          </button>
        )}
        {removable && !confirming && (
          <button type="button" className="button" disabled={sending} onClick={() => setConfirming(true)}>
            {t.common.remove}
          </button>
        )}
        {removable && confirming && (
          <>
            <span className="accounts__confirm">
              {entry.sessions.length > 0 ? t.account.removeWhenDone(entry.sessions.join(', ')) : t.account.removeNow}
            </span>
            <button
              type="button"
              className="button button--danger"
              disabled={sending}
              onClick={() => void send('account/remove', { account: entry.key }).then(() => setConfirming(false))}
            >
              {t.common.remove}
            </button>
            <button type="button" className="button" disabled={sending} onClick={() => setConfirming(false)}>
              {t.common.cancel}
            </button>
          </>
        )}
        {entry.removing && (
          <button type="button" className="button" disabled={sending} onClick={() => void send('account/keep', { account: entry.key })}>
            {t.account.keep}
          </button>
        )}
      </div>
    </li>
  )
}

function staleNote(reason: string | null): string {
  return reason === null ? t.account.staleExpired : t.account.staleBusy
}

function Blockers({ block }: { block: LoginBlock }) {
  return (
    <div className="account__blockers">
      <p className="queue__hint">{t.account.switchBlocked}</p>
      <ul className="account__blocker-list">
        {block.chain !== null && (
          <li>
            {t.account.chainBusy.before}
            <Link to={`/p/${block.chain}`}>{block.chain}</Link>
            {t.account.chainBusy.after}
          </li>
        )}
        {block.sessions.map((session, index) => (
          <li key={`${session.name}-${index}`}>
            <span className="account__blocker-name">{session.name}</span>{' '}
            {session.status === 'busy'
              ? t.account.busy
              : session.waitingFor === null
                ? t.account.waiting
                : t.account.waitingFor(session.waitingFor)}
          </li>
        ))}
      </ul>
      {block.sessions.length > 0 && <p className="queue__hint">{t.account.turnHint}</p>}
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
            {t.common.retry}
          </button>
          <button type="button" className="button" disabled={sending} onClick={() => void send('account/cancel')}>
            {t.common.close}
          </button>
        </div>
        {login.output !== '' && <Output text={login.output} />}
      </>
    )
  }

  return (
    <>
      {login.urls.length === 0 ? (
        <p className="queue__hint">{t.account.waitingLink}</p>
      ) : (
        <ul className="account__links">
          {login.urls.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noreferrer">
                {login.urls.length === 1 ? t.account.openLogin : new URL(url).host}
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
          placeholder={t.account.code}
          aria-label={t.account.code}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="button" disabled={sending || code.trim() === ''}>
          {t.account.send}
        </button>
      </form>
      <p className="queue__hint">{login.codeSent ? t.account.codeSent : t.account.codeHint}</p>
      <div className="account__actions">
        <button type="button" className="button" disabled={sending} onClick={() => void send('account/cancel')}>
          {t.account.cancelLogin}
        </button>
      </div>
      {login.output !== '' && <Output text={login.output} />}
    </>
  )
}

function Output({ text }: { text: string }) {
  return (
    <details className="account__output">
      <summary>{t.account.output}</summary>
      <pre>{text}</pre>
    </details>
  )
}
