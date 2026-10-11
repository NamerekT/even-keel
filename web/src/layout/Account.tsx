import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { removeProblem, switchProblem, type AccountEntry, type AccountLogin, type AccountView } from '../../../src/account/model.js'
import { APP_LABELS, appSwitchProblem, type AppAccount } from '../../../src/account/apps.js'
import type { Notice } from '../../../src/notice/notice.js'
import { accountSlot } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { accountBadge, accountOrder, canWork, loginLeft } from '../state.js'
import { seriesStyle } from '../ui/series.js'
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
  const ordered = accountOrder(account.accounts, now)
  const running = account.loginBlock?.chains ?? []
  const active = account.accounts.find((entry) => entry.key === account.active)

  return (
    <aside id="account-panel" className="drawer" role="dialog" aria-label={t.account.title}>
      <div className="drawer__head">
        <h2 className="drawer__title">{t.account.title}</h2>
        <button type="button" className="panel__close" aria-label={t.common.close} onClick={onClose}>
          ×
        </button>
      </div>

      <section className="queue__section">
        <h2 className="queue__heading">{t.account.folders}</h2>
        {account.accounts.length === 0 ? (
          <p className="queue__empty">{t.account.notLoaded}</p>
        ) : (
          <ul className="accounts">
            <li className="accounts__columns" aria-hidden="true">
              <span>{t.limits.fiveHour}</span>
              <span>{t.limits.week}</span>
            </li>
            {ordered.map((entry) => (
              <AccountItem key={entry.key} entry={entry} view={account} now={now} sending={sending} send={send} />
            ))}
          </ul>
        )}
        {login === null && (
          <div className="accounts__add">
            <button type="button" className="button" disabled={sending} onClick={() => void send('account/add')}>
              + {t.account.add}
            </button>
            <p className="queue__hint">{t.account.addHint}</p>
          </div>
        )}
      </section>

      {login !== null && (
        <section className="queue__section">
          <h2 className="queue__heading">{loginHeading(account)}</h2>
          <LoginSteps login={login} sending={sending} send={send} />
        </section>
      )}

      <section className="queue__section">
        <h2 className="queue__heading">{t.account.roles}</h2>
        <ul className="roles">
          {running.length > 0 && (
            <li className="roles__item">
              <span className="roles__label">Even Keel</span>
              <div className="account__blockers">
                <p className="queue__hint">{t.account.chainsRunning}</p>
                <ul className="account__blocker-list">
                  {running.map((project) => (
                    <li key={project}>
                      <Link to={`/p/${project}`}>{project}</Link>
                    </li>
                  ))}
                </ul>
                <p className="queue__hint">{t.account.chainsStay(active === undefined ? account.active : accountName(active))}</p>
              </div>
            </li>
          )}
          {account.apps.map((app) => (
            <AppNotes key={app.app} app={app} />
          ))}
        </ul>
      </section>

      {failure !== null && <p className="notice notice--error queue__error">{say(failure)}</p>}
    </aside>
  )
}

function accountName(entry: AccountEntry): string {
  return entry.status?.email ?? (entry.global ? t.account.global : entry.key)
}

function AppNotes({ app }: { app: AppAccount }) {
  const label = APP_LABELS[app.app]
  return (
    <li className="roles__item">
      <span className="roles__label">{label}</span>
      {app.account === null && <p className="queue__hint">{t.account.appOn(appAccountName(app))}</p>}
      {app.error !== null && <p className="notice notice--error">{say(app.error)}</p>}
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
      <p className="queue__hint">{t.account.reload(label)}</p>
    </li>
  )
}

function appAccountName(app: AppAccount): string {
  if (app.dir !== null) return t.account.unknownDir(app.dir)
  return app.error === null ? t.account.unread : '—'
}

interface Role {
  label: string
  on: boolean
  problem: Notice | undefined
  pick: () => void
}

function rolesOf(entry: AccountEntry, view: AccountView, send: Send): Role[] {
  return [
    {
      label: 'Even Keel',
      on: entry.key === view.active,
      problem: switchProblem(view, entry.key),
      pick: () => void send('account/switch', { account: entry.key }),
    },
    ...view.apps.map((app) => ({
      label: APP_LABELS[app.app],
      on: app.account === entry.key,
      problem: appSwitchProblem(view, app.app, entry.key),
      pick: () => void send('account/app', { app: app.app, account: entry.key }),
    })),
  ]
}

function RoleButtons({ roles, sending }: { roles: Role[]; sending: boolean }) {
  return (
    <div className="accounts__roles">
      {roles.map((role) => (
        <button
          key={role.label}
          type="button"
          className={`accounts__role${role.on ? ' accounts__role--on' : ''}`}
          aria-pressed={role.on}
          disabled={role.on || sending || role.problem !== undefined}
          title={role.on ? t.account.holds(role.label) : role.problem !== undefined ? say(role.problem) : t.account.take(role.label)}
          onClick={role.pick}
        >
          {role.on && <span aria-hidden="true">✓ </span>}
          {role.label}
        </button>
      ))}
    </div>
  )
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
  const [open, setOpen] = useState(false)
  const active = entry.key === view.active
  const left = loginLeft(entry.loginExpiresAt, now)
  const renewBlocked = view.login !== null || (active && view.loginBlock !== null)
  const off = !canWork(entry, now)
  const name = accountName(entry)
  const at = name.lastIndexOf('@')
  const email = entry.status?.email ?? null
  const slot = email === null ? null : accountSlot(view, email)

  return (
    <li className={`accounts__item${off ? ' accounts__item--off' : ''}`} style={seriesStyle(slot)}>
      <div className="accounts__head">
        <span className="accounts__dot" aria-hidden="true" />
        <span className="accounts__email" title={name}>
          {at > 0 ? name.slice(0, at) : name}
          {at > 0 && <span className="accounts__domain">{name.slice(at)}</span>}
        </span>
        <button
          type="button"
          className="accounts__more"
          aria-expanded={open}
          aria-label={t.account.details}
          title={t.account.details}
          onClick={() => setOpen(!open)}
        >
          ⋯
        </button>
      </div>
      <Limits limits={entry.limits} now={now} bare />
      {entry.limits === null && entry.usage.state === 'stale' && (
        <p className="accounts__note">
          {t.account.noLimits}
          {staleNote(entry.usage.reason)}
        </p>
      )}
      {(left.renew || entry.needsLogin) && (
        <div className="accounts__note accounts__note--warn">
          <span>{entry.needsLogin ? t.account.needsLogin : t.account.expiry(left.text)}</span>
          <button
            type="button"
            className="button button--small"
            disabled={sending || renewBlocked}
            onClick={() => void send('account/renew', { account: entry.key })}
          >
            {entry.needsLogin ? t.account.login : t.account.renew}
          </button>
        </div>
      )}
      {entry.removing && (
        <div className="accounts__note accounts__note--warn">
          <span>
            {t.account.removing}
            {entry.sessions.length > 0 ? t.account.removingAlive(entry.sessions.join(', ')) : ''}
          </span>
          <button type="button" className="button button--small" disabled={sending} onClick={() => void send('account/keep', { account: entry.key })}>
            {t.account.keep}
          </button>
        </div>
      )}
      {entry.configPending && <p className="accounts__note">{t.account.configPending}</p>}
      {entry.error !== null && <p className="accounts__note">{t.account.checkFailed(say(entry.error))}</p>}
      {open && <AccountDetails entry={entry} view={view} left={left.text} sending={sending} send={send} />}
      <RoleButtons roles={rolesOf(entry, view, send)} sending={sending} />
    </li>
  )
}

interface DetailsProps {
  entry: AccountEntry
  view: AccountView
  left: string
  sending: boolean
  send: Send
}

function AccountDetails({ entry, view, left, sending, send }: DetailsProps) {
  const [confirming, setConfirming] = useState(false)
  const kept = removeProblem(view, entry.key)

  return (
    <div className="accounts__details">
      <div className="accounts__facts">
        {entry.status?.subscriptionType != null && <span>{t.account.plan(entry.status.subscriptionType)}</span>}
        <span>{t.account.expiry(left)}</span>
        {entry.sessions.length > 0 && <span>{t.account.sessions(entry.sessions.length)}</span>}
        {entry.global && <span>{t.account.globalFolder}</span>}
      </div>
      {entry.removing ? null : kept !== undefined ? (
        <p className="accounts__note">{say(kept)}</p>
      ) : confirming ? (
        <div className="account__actions">
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
        </div>
      ) : (
        <div className="account__actions">
          <button type="button" className="button" disabled={sending} onClick={() => setConfirming(true)}>
            {t.common.remove}
          </button>
        </div>
      )}
    </div>
  )
}

function staleNote(reason: Notice | null): string {
  return reason === null ? t.account.staleExpired : t.account.staleBusy
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
        <p className="notice notice--error">{say(login.error)}</p>
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
