import type { MachineSignIn } from '../../../src/state.js'
import { say, t } from '../i18n/index.js'
import { useLive } from '../live/context.js'
import { useCommand } from '../live/useCommand.js'
import { CommandBlock } from '../ui/blocks.js'
import { requestCli } from './CliCopies.js'
import { InstallButton, InstallOutput, installOf } from './CliInstall.js'
import { cliText } from './cliText.js'
import './cliCopies.css'

/**
 * The CLI of an agent a machine elsewhere lacks (BTN-1502), opened from its tile in "A new account on …": the command its
 * service would run, "Install" running it there and its output, "Check again" after an install by hand. Where nobody
 * can install it (a container) the machine runs the checked copy: the hub's own move to it is what the machine follows
 * (BTN-1516), so the button says the hub's sessions move too.
 */
export function MachineCliInstall({ machine, agent, back }: { machine: MachineSignIn; agent: string; back: () => void }) {
  const view = t.machinePanel.view
  const { state } = useLive()
  const { send, sending, failure } = useCommand()
  const title = (t.account.agents as Record<string, string>)[agent] ?? agent
  const command = machine.installs?.[agent]
  const install = installOf(machine.install, agent)
  const hubCopy = state?.cliCopies?.[agent]
  const hubChecked = hubCopy !== undefined && hubCopy.source !== 'system'
  const toChecked = async () => {
    if (!(await send('cli/checked', { agent }))) return
    if (hubCopy?.checkedStatus !== 'ready') requestCli(agent)
  }
  return (
    <>
      <div className="add-package__body">
        <div className="cli-copy">
          <p>{command === undefined ? view.installNone(title, machine.name) : view.installLead(title, machine.name)}</p>
          {command !== undefined && <CommandBlock command={command} />}
          {install !== null && <InstallOutput install={install} title={title} />}
          {hubCopy !== undefined && <p className="cli-copy__aside">{hubChecked ? view.checkedComing(machine.name) : view.checkedNote}</p>}
        </div>
      </div>
      {failure && <p role="alert" className="notice notice--error add-package__failure">{say(failure)}</p>}
      <footer className="add-package__foot cli-install__foot">
        <button type="button" className="button" disabled={sending} onClick={back}>
          ← {t.account.back}
        </button>
        <span className="add-package__spacer" />
        <button type="button" className="button" disabled={sending} onClick={() => void send('machines/checkClis', { machine: machine.machine })}>
          {cliText().again}
        </button>
        {hubCopy !== undefined && !hubChecked && (
          <button type="button" className={`button${command === undefined ? ' button--primary' : ''}`} disabled={sending} onClick={() => void toChecked()}>
            {view.useChecked}
          </button>
        )}
        {command !== undefined && <InstallButton primary small={false} install={install} busy={sending} onInstall={() => void send('machines/installCli', { machine: machine.machine, agent })} />}
      </footer>
    </>
  )
}
