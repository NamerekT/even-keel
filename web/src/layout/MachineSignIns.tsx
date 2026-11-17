import { useEffect, useId, useRef } from 'react'
import type { AccountEntry } from '../../../src/account/model.js'
import { CODEX } from '../../../src/codex/name.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { machineGaps, machineLogin, machineSend } from '../machineSignIn.js'
import { Tipped } from '../ui/Tipped.js'
import { LOGIN_FOCUS, LoginSteps, type Send } from './accountParts.js'
import '../tools/addPackage.css'

/**
 * Under a hub account, each machine elsewhere where it is not signed in, with "Sign in" there (BTN-1245): the sign-in
 * runs on that machine, and its link and code show in `MachineLoginDialog`.
 */
export function MachineNotes({ entry, send, sending }: { entry: AccountEntry; send: Send; sending: boolean }) {
  const { state } = useLive()
  const machines = state?.machineSignIns
  const gaps = machineGaps(entry, machines)
  if (gaps.length === 0) return null
  const busy = sending || machineLogin(machines) !== undefined
  return <div className="account-machines">
    {gaps.map((gap) => <div key={gap.machine} className="account-machines__row">
      <span>{gap.noCli ? t.account.machineNoCli(gap.name) : t.account.machineNotSigned(gap.name)}</span>
      {!gap.noCli && (gap.online ? (
        <button type="button" className="button button--small" disabled={busy}
          onClick={() => void send('machines/login', { machine: gap.machine, agent: entry.agent, ...(gap.account !== undefined && { account: gap.account }) })}>
          {t.account.login}
        </button>
      ) : (
        <Tipped className="account__actions" tip={t.account.machineOffline(gap.name)} align="start">
          <button type="button" className="button button--small" aria-disabled="true">{t.account.login}</button>
        </Tipped>
      ))}
    </div>)}
  </div>
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
