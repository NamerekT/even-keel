import type { CliInstallView } from '../../../src/agent/cli-installer.js'
import { say } from '../i18n/index.js'
import { Output } from './accountParts.js'
import { cliText } from './cliText.js'

/** The install of `agent` a panel carries; `null` — none of its, or another agent's. */
export const installOf = (install: CliInstallView | null | undefined, agent: string): CliInstallView | null =>
  install?.agent === agent ? install : null

/** "Install": the agent's official installer, run by the service as its user (BTN-1502); off while one runs. */
export function InstallButton({ install, busy, onInstall, primary = false, small = true }: { install: CliInstallView | null; busy: boolean; onInstall: () => void; primary?: boolean; small?: boolean }) {
  const text = cliText()
  const running = install?.state === 'running'
  return <button type="button" className={`button${small ? ' button--small' : ''}${primary ? ' button--primary' : ''}`} disabled={busy || running} onClick={onInstall}>
    {running ? text.installRunning : text.install}
  </button>
}

/** How the installer goes or ended, and what it printed: open while it runs or after it failed. */
export function InstallOutput({ install, title }: { install: CliInstallView; title: string }) {
  const text = cliText()
  const failed = install.state === 'failed'
  return <div className="cli-install" role="status">
    {!failed && <p>{install.state === 'running' ? text.installRunning : text.installDone}</p>}
    {install.output !== '' && <Output text={install.output} open={install.state !== 'done'} />}
    {failed && <p className="notice notice--error">{say({ code: 'agent.installFailed', params: { title } })}</p>}
  </div>
}
