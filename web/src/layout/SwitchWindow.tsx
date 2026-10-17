import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { CLAUDE } from '../../../src/claude/name.js'
import { switchProblem, type AccountEntry, type AccountView } from '../../../src/account/model.js'
import { APP_LABELS, appSwitchProblem, type AppAccount } from '../../../src/account/apps.js'
import type { Notice } from '../../../src/notice/notice.js'
import { accountSlot } from '../accounts.js'
import { say, t } from '../i18n/index.js'
import { useCommand } from '../live/useCommand.js'
import { useLive } from '../live/context.js'
import { accountOrder, projectPath } from '../state.js'
import { ProjectLabel } from '../ui/ProjectLabel.js'
import { seriesStyle } from '../ui/series.js'
import { accountName, AccountName, type Send } from './accountParts.js'
import { useNow } from './useNow.js'
import './switch.css'

interface Role {
  label: string
  holder: string | null
  problem: (key: string) => Notice | undefined
  pick: (key: string) => void
  notes: ReactNode
}

/**
 * The one window that switches accounts, from the drawer and from the accounts page: per role — Even Keel and each app —
 * the Claude accounts to pick from, why one cannot take it, and what the switch leaves as it is.
 */
export function SwitchWindow({ account, onClose }: { account: AccountView; onClose: () => void }) {
  const { send, sending, failure } = useCommand()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const now = useNow(60_000)
  const choices = accountOrder(
    account.accounts.filter((entry) => entry.agent === CLAUDE),
    now,
  )

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="switch-window"
      aria-labelledby="switch-title"
      onClose={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation()
      }}
      onClick={(event) => {
        event.stopPropagation()
        if (event.target === dialogRef.current) dialogRef.current.close()
      }}
    >
      <div className="switch-window__body">
        <header className="drawer__head">
          <h2 id="switch-title" className="drawer__title">
            {t.account.switchTitle}
          </h2>
          <button type="button" className="panel__close" aria-label={t.common.close} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        {rolesOf(account, send).map((role) => (
          <section key={role.label} className="switch-window__role" aria-label={role.label}>
            <h3 className="switch-window__label">{role.label}</h3>
            <ul className="switch-window__list">
              {choices.map((entry) => (
                <Choice key={entry.key} entry={entry} view={account} role={role} sending={sending} />
              ))}
            </ul>
            {role.notes}
          </section>
        ))}
        {failure !== null && <p className="notice notice--error">{say(failure)}</p>}
      </div>
    </dialog>
  )
}

function Choice({ entry, view, role, sending }: { entry: AccountEntry; view: AccountView; role: Role; sending: boolean }) {
  const on = role.holder === entry.key
  const problem = on ? undefined : role.problem(entry.key)
  const email = entry.status?.email ?? null
  const why = problem === undefined ? null : say(problem)

  return (
    <li style={seriesStyle(email === null ? null : accountSlot(view, email))}>
      <button
        type="button"
        className={`switch-window__pick${on ? ' switch-window__pick--on' : ''}${problem === undefined ? '' : ' switch-window__pick--off'}`}
        aria-pressed={on}
        disabled={on || sending || problem !== undefined}
        title={on ? t.account.holds(role.label) : (why ?? t.account.take(role.label))}
        onClick={() => role.pick(entry.key)}
      >
        <span className="accounts__dot" aria-hidden="true" />
        <AccountName entry={entry} />
        {on && <span className="switch-window__check">✓</span>}
        {why !== null && <span className="switch-window__why">{why}</span>}
      </button>
    </li>
  )
}

function rolesOf(view: AccountView, send: Send): Role[] {
  return [
    {
      label: 'Even Keel',
      holder: view.active,
      problem: (key) => switchProblem(view, key),
      pick: (key) => void send('account/switch', { account: key }),
      notes: <ChainNotes view={view} />,
    },
    ...view.apps.map((app) => ({
      label: APP_LABELS[app.app],
      holder: app.account,
      problem: (key: string) => appSwitchProblem(view, app.app, key),
      pick: (key: string) => void send('account/app', { app: app.app, account: key }),
      notes: <AppNotes app={app} />,
    })),
  ]
}

function ChainNotes({ view }: { view: AccountView }) {
  const { state } = useLive()
  const running = view.loginBlock?.chains ?? []
  const active = view.accounts.find((entry) => entry.key === view.active)
  if (running.length === 0) return null
  return (
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
      <p className="queue__hint">{t.account.chainsStay(active === undefined ? view.active : accountName(active))}</p>
    </div>
  )
}

function AppNotes({ app }: { app: AppAccount }) {
  const label = APP_LABELS[app.app]
  return (
    <>
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
    </>
  )
}

function appAccountName(app: AppAccount): string {
  if (app.dir !== null) return t.account.unknownDir(app.dir)
  return app.error === null ? t.account.unread : '—'
}
