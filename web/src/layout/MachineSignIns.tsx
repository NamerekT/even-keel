import { useEffect, useId, useRef, useState } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { CODEX } from '../../../src/codex/name.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { fullSignIn, hubSessionsOnly, machineGaps, machineLogin, machineSend, machineTokens } from '../machineSignIn.js'
import { Tipped } from '../ui/Tipped.js'
import { LOGIN_FOCUS, LoginSteps, type Send } from './accountParts.js'
import { MachineTokenDialog, type MachineTokenTarget } from './MachineTokenDialog.js'
import '../tools/addPackage.css'

/**
 * Under a hub account, each machine elsewhere where it is not signed in, with "Sign in" there (BTN-1245): the sign-in
 * runs on that machine, and its link and code show in `MachineLoginDialog`.
 */
export function MachineNotes({ entry, send, sending }: { entry: AccountEntry; send: Send; sending: boolean }) {
  const { state } = useLive()
  const [token, setToken] = useState<MachineTokenTarget | null>(null)
  const machines = state?.machineSignIns
  const gaps = machineGaps(entry, machines)
  const tokens = machineTokens(entry, machines)
  // A machine's token nobody polls for is marked in its own line: the hub's folder of it signs in by its own "Sign in".
  const alone = hubSessionsOnly(entry, state?.account?.accounts ?? [])
  if (gaps.length === 0 && tokens.length === 0 && !alone) return null
  const busy = sending || machineLogin(machines) !== undefined
  const who = entry.status?.email ?? entry.key
  return <div className="account-machines">
    {alone && <div className="account-machines__row"><SessionsOnly email={null} send={send} sending={busy} /></div>}
    {gaps.map((gap) => <div key={gap.machine} className="account-machines__row">
      <span>{gap.noCli ? t.account.machineNoCli(gap.name) : t.account.machineNotSigned(gap.name)}</span>
      {!gap.noCli && (gap.online ? (
        <>
          <button type="button" className="button button--small" disabled={busy}
            onClick={() => void send('machines/login', { machine: gap.machine, agent: entry.agent, ...(gap.account !== undefined && { account: gap.account }) })}>
            {t.account.login}
          </button>
          {entry.agent === CLAUDE && (
            <Tipped tip={t.account.machineTokenTip} align="start">
              <button type="button" className="button button--small" disabled={busy}
                onClick={() => setToken({ machine: gap.machine, name: gap.name, account: entry.key, who })}>
                {t.account.machineToken}
              </button>
            </Tipped>
          )}
        </>
      ) : (
        <Tipped className="account__actions" tip={t.account.machineOffline(gap.name)} align="start">
          <button type="button" className="button button--small" aria-disabled="true">{t.account.login}</button>
        </Tipped>
      ))}
    </div>)}
    {tokens.map((each) => <div key={each.machine} className="account-machines__row">
      <Tipped className="account-machines__token" align="start" focusable
        tip={each.sessionsOnly ? <><span>{t.account.machineOnTokenTip(each.name)}</span><span>{say(SESSIONS_ONLY)}</span></> : t.account.machineOnTokenTip(each.name)}>
        {each.name} · {t.account.machineOnToken}{each.sessionsOnly && ` · ${t.account.sessionsOnly}`}
      </Tipped>
    </div>)}
    {token !== null && <MachineTokenDialog target={token} onClose={() => setToken(null)} />}
  </div>
}

const SESSIONS_ONLY = { code: 'usage.sessionsOnly', params: {} } as const

/**
 * "Limits from sessions only" of an account no full sign-in polls (BTN-1266), why in its tip, and "Sign in fully" on
 * the hub: again in the hub's folder of `email`, else in a new one; the hub's `LoginDialog` follows the sign-in.
 */
export function SessionsOnly({ email, send, sending }: { email: string | null; send: Send; sending: boolean }) {
  const { state } = useLive()
  const [command, body] = fullSignIn(email, state?.account?.accounts ?? [])
  return <>
    <Tipped className="account-machines__token" tip={say(SESSIONS_ONLY)} align="start" focusable>
      {t.account.sessionsOnly}
    </Tipped>
    <button type="button" className="button button--small" disabled={sending || state?.account?.login != null} onClick={() => void send(command, body)}>
      {t.account.signInFully}
    </button>
  </>
}

/**
 * A sign-in under way on a machine elsewhere, over whatever page is open, as `LoginDialog` is for the hub's own: the
 * link opens in the person's browser, the code goes back through the hub to the machine's CLI. Closing cancels it there.
 */
export function MachineLoginDialog() {
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const machine = machineLogin(state?.machineSignIns)

  useEffect(() => {
    if (dialog.current?.open !== false) return
    dialog.current.showModal()
    dialog.current.querySelector<HTMLElement>(LOGIN_FOCUS)?.focus()
  })

  if (machine?.login == null) return null
  const { login } = machine
  const remote = machineSend(machine.machine, send)
  const cancel = () => void remote('account/cancel')

  return (
    <dialog
      ref={dialog}
      className="add-package"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
    >
      <div className="add-package__frame">
        <header className="add-package__head">
          <h2 id={title} className="add-package__title">{t.account.machineLogin(machine.name)}</h2>
          <button type="button" className="panel__close" aria-label={t.account.cancelLogin} disabled={sending} onClick={cancel}>
            ×
          </button>
        </header>
        <div className="add-package__body">
          <p className="login-rows__hint">{t.account.machineLoginNote}</p>
          <LoginSteps login={login} device={login.agent === CODEX || login.agent === OPENCODE} sending={sending} send={remote} />
        </div>
        {failure !== null && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
        {login.error === null && (
          <footer className="add-package__foot">
            <span className="add-package__spacer" />
            <button type="button" className="button" disabled={sending} onClick={cancel}>
              {t.account.cancelLogin}
            </button>
          </footer>
        )}
      </div>
    </dialog>
  )
}
