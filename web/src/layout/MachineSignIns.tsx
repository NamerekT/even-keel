import { useEffect, useId, useRef } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { CODEX } from '../../../src/codex/name.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { fullSignIn, hubSessionsOnly, machineLogin, machineMarks, machineSend } from '../machineSignIn.js'
import { MachineLabels } from '../ui/MachineLabel.js'
import { Tipped } from '../ui/Tipped.js'
import { LOGIN_FOCUS, LoginSteps, type Send } from './accountParts.js'
import '../tools/addPackage.css'

/**
 * Under a hub long-token folder nobody polls for (BTN-1266), "limits from sessions only" with "Sign in fully". The
 * machines elsewhere the account is on are its row's "Machines" column (`AccountMachines`).
 */
export function MachineNotes({ entry, send, sending }: { entry: AccountEntry; send: Send; sending: boolean }) {
  const { state } = useLive()
  if (!hubSessionsOnly(entry, state?.account?.accounts ?? [])) return null
  const busy = sending || machineLogin(state?.machineSignIns) !== undefined
  return <div className="account-machines">
    <div className="account-machines__row"><SessionsOnly email={null} send={send} sending={busy} /></div>
  </div>
}

/**
 * The accounts page's "Machines" column of a hub account (BTN-1309): a label for each machine elsewhere it is on —
 * signed in, on a long token only (a key, why in the tip), or its folder signed out there, whose press signs it in
 * again in that folder (`machines/login`; its link and code show in `MachineLoginDialog`). A machine it never signed in
 * on is not named: "Add account" signs it in there.
 */
export function AccountMachines({ entry, send, sending }: { entry: AccountEntry; send: Send; sending: boolean }) {
  const { state } = useLive()
  const machines = state?.machineSignIns
  const busy = sending || machineLogin(machines) !== undefined
  const marks = machineMarks(entry, state?.account?.accounts ?? [], machines)
  return <MachineLabels items={marks.map((mark) => ({
    id: mark.machine,
    name: mark.name,
    ...(state?.machineColors?.[mark.machine] !== undefined && { color: state.machineColors[mark.machine] }),
    kind: mark.kind,
    ...(mark.kind === 'token' && {
      tip: mark.sessionsOnly ? <><span>{t.account.machineOnTokenTip(mark.name)}</span><span>{say(SESSIONS_ONLY)}</span></> : t.account.machineOnTokenTip(mark.name),
    }),
    ...(mark.kind === 'out' && {
      tip: mark.online ? t.account.machineSignedOut(mark.name) : t.account.machineOffline(mark.name),
      disabled: !mark.online || busy,
      onPress: () => void send('machines/login', { machine: mark.machine, agent: entry.agent, account: mark.account }),
    }),
  }))} />
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
