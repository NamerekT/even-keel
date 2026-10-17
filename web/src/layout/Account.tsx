import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { removeProblem, switchProblem, type AccountEntry, type AccountLogin, type AccountView } from '../../../src/account/model.js'
import { APP_LABELS, appSwitchProblem, type AppAccount } from '../../../src/account/apps.js'
import type { Notice } from '../../../src/notice/notice.js'
import { accountSlot } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useLive } from '../live/context.js'
import { accountOrder, canWork, loginLeft, projectPath } from '../state.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { seriesStyle } from '../ui/series.js'
import { formatUsd } from '../stats/format.js'
import { Limits } from './Limits.js'
import { useNow } from './useNow.js'

type Send = (name: string, body?: Record<string, unknown>) => Promise<boolean>

/** Today's spend in dollars by account folder key; null while Tally has not answered. */
export type Spend = Record<string, number> | null

export function spendText(spend: Spend, key: string): string {
  if (spend === null) return t.account.todayNone
  return t.account.today(formatUsd(spend[key] ?? 0))
}

export function AccountPanel({ account, spend, onClose }: { account: AccountView; spend: Spend; onClose: () => void }) {
  const { send, sending, failure } = useCommand()
  const { state } = useLive()
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
              <AccountItem key={entry.key} entry={entry} view={account} now={now} spend={spend} sending={sending} send={send} />
            ))}
          </ul>
        )}
        {login === null && (
          <div className="accounts__add">
            <button type="button" className="button" disabled={sending} onClick={() => void send('account/add')}>
              + {t.account.add}
            </button>
            <p className="queue__hint">{t.account.addHint}</p>
            <ApiKeyForm sending={sending} send={send} />
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
                      <Link to={projectPath(state, project)}>
                        <ProjectLabel project={project} />
                      </Link>
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

function ApiKeyForm({ sending, send }: { sending: boolean; send: Send }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [key, setKey] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!(await send('account/api', { name, key }))) return
    setName('')
    setKey('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button type="button" className="button" disabled={sending} onClick={() => setOpen(true)}>
        + {t.account.addKey}
      </button>
    )
  }
  return (
    <form className="account__key" onSubmit={(event) => void submit(event)}>
      <input
        className="account__input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t.account.keyName}
        aria-label={t.account.keyName}
        autoComplete="off"
        spellCheck={false}
      />
      <input
        className="account__input"
        type="password"
        value={key}
        onChange={(event) => setKey(event.target.value)}
        placeholder={t.account.keyValue}
        aria-label={t.account.keyValue}
        autoComplete="off"
        spellCheck={false}
      />
      <div className="account__actions">
        <button type="submit" className="button button--primary" disabled={sending || key.trim() === ''}>
          {t.account.keyAdd}
        </button>
        <button type="button" className="button" disabled={sending} onClick={() => setOpen(false)}>
          {t.common.cancel}
        </button>
      </div>
      <p className="queue__hint">{t.account.keyHint}</p>
    </form>
  )
}

interface ItemProps {
  entry: AccountEntry
  view: AccountView
  now: Date
  spend: Spend
  sending: boolean
  send: Send
}

function AccountItem({ entry, view, now, spend, sending, send }: ItemProps) {
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
      {entry.apiKey ? (
        <p className="accounts__note accounts__spend" title={t.account.todayTitle}>
          <span className="tag">{t.account.apiKey}</span>
          {spendText(spend, entry.key)}
        </p>
      ) : (
        <Limits limits={entry.limits} now={now} bare />
      )}
      {!entry.apiKey && entry.limits === null && entry.usage.state === 'stale' && (
        <p className="accounts__note">
          {t.account.noLimits}
          {staleNote(entry.usage.reason)}
        </p>
      )}
      {entry.apiKey && entry.needsLogin && <p className="accounts__note accounts__note--warn">{t.account.apiKeyLost}</p>}
      {!entry.apiKey && (left.renew || entry.needsLogin) && (
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
        {entry.apiKey ? (
          <span>{t.account.apiKey}</span>
        ) : (
          <>
            {entry.status?.subscriptionType != null && <span>{t.account.plan(entry.status.subscriptionType)}</span>}
            <span>{t.account.expiry(left)}</span>
          </>
        )}
        {entry.sessions.length > 0 && <span>{t.account.sessions(entry.sessions.length)}</span>}
        {entry.global && <span>{t.account.globalFolder}</span>}
      </div>
      {entry.removing ? null : kept !== undefined ? (
        <p className="accounts__note">{say(kept)}</p>
      ) : confirming ? (
        <div className="account__actions">
          <span className="accounts__confirm">
            {removeQuestion(entry)}
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

function removeQuestion(entry: AccountEntry): string {
  const sessions = entry.sessions.join(', ')
  if (entry.apiKey) return sessions === '' ? t.account.removeKeyNow : t.account.removeKeyWhenDone(sessions)
  return sessions === '' ? t.account.removeNow : t.account.removeWhenDone(sessions)
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
