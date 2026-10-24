import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join, win32 } from 'node:path'
import { promisify } from 'node:util'

/** How the update process stops and starts the service: one command each, run without a shell. */
export interface ServiceControl {
  /** `autostart` — the tray host `EvenKeel.exe` the user's sign-in starts on Windows (BTN-372). */
  kind: 'windows' | 'systemd' | 'launchd' | 'autostart'
  name: string
  stop: string[]
  start: string[]
}

/** The tray host's file name (`service/EvenKeelTray.cs`); `src/autostart.ts` compiles it. */
export const LAUNCHER_EXE = 'EvenKeel.exe'

/**
 * The tray host that runs this process, from `tasklist /fo csv /nh` of the parent and the `EVEN_KEEL_LAUNCHER` it sets:
 * the variable alone is inherited by every session, the parent alone does not give the exe's path.
 */
export function launcherOf(csv: string, env: NodeJS.ProcessEnv): string | null {
  const image = csv.trim().split(/\r?\n/)[0]?.match(/^"([^"]*)"/)?.[1]
  const exe = env.EVEN_KEEL_LAUNCHER
  if (exe === undefined || image?.toLowerCase() !== LAUNCHER_EXE.toLowerCase()) return null
  return win32.basename(exe).toLowerCase() === LAUNCHER_EXE.toLowerCase() ? exe : null
}

/**
 * `--stop` holds node stopped inside the host and waits for it, `--start` starts it again; with no host running,
 * `--start` starts one with `args` (`<root> <node> [<data>]`). The host stays, so a stop and a start from SSH work too.
 */
export function autostartControl(exe: string, args: string[]): ServiceControl {
  return { kind: 'autostart', name: exe, stop: [exe, '--stop'], start: [exe, ...args, '--start'] }
}

/** The arguments the host takes: the root, node and the data folder of a package (`EVEN_KEEL_DATA`), as it got them. */
export function launcherArgsOf(root: string, node: string, env: NodeJS.ProcessEnv): string[] {
  return env.EVEN_KEEL_DATA ? [root, node, env.EVEN_KEEL_DATA] : [root, node]
}

/** The service in `tasklist /svc /fo csv /nh` of the parent process: the Windows service host runs node itself. */
export function windowsServiceOf(csv: string): string | null {
  const fields = csv.trim().split(/\r?\n/)[0]?.match(/"([^"]*)"/g)
  const name = fields?.[2]?.slice(1, -1).split(',')[0]?.trim()
  return name === undefined || name === '' || name === 'N/A' ? null : name
}

/** The user unit of `/proc/self/cgroup`; a system unit or a terminal's scope is none: `install.sh` installs a user unit. */
export function systemdUnitOf(cgroup: string): string | null {
  for (const line of cgroup.split('\n')) {
    const path = line.slice(line.lastIndexOf(':') + 1)
    if (!/\/user@\d+\.service\//.test(path)) continue
    const unit = path.split('/').at(-1)
    if (unit?.endsWith('.service') === true && !unit.startsWith('user@')) return unit
  }
  return null
}

/** launchd names its job in `XPC_SERVICE_NAME`; a terminal has `0` or an application's name there. */
export function launchdLabelOf(env: NodeJS.ProcessEnv): string | null {
  const label = env.XPC_SERVICE_NAME
  return label === undefined || label === '0' || label.startsWith('application.') ? null : label
}

const WINDOWS_NAME = /^[\w.-]+$/

/** `Stop-Service` waits for the stop, and neither cmdlet fails on a service already in the state asked for. */
export function windowsControl(name: string): ServiceControl {
  if (!WINDOWS_NAME.test(name)) throw new Error(`unexpected Windows service name ${name}`)
  const powershell = (command: string) => ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', `${command} -Name '${name}' -ErrorAction Stop`]
  return { kind: 'windows', name, stop: powershell('Stop-Service'), start: powershell('Start-Service') }
}

/** `KillMode=process` of the unit: a stop kills only the service's own process, not the update process it started. */
export function systemdControl(unit: string): ServiceControl {
  return { kind: 'systemd', name: unit, stop: ['systemctl', '--user', 'stop', unit], start: ['systemctl', '--user', 'start', unit] }
}

/** As `install.sh` does it: `bootstrap` fails while the old job is still going away. */
const BOOTOUT = 'launchctl bootout "$0/$1" 2>/dev/null; n=0; while launchctl print "$0/$1" >/dev/null 2>&1 && [ "$n" -lt 40 ]; do sleep 0.5; n=$((n+1)); done'

export function launchdControl(label: string, uid: number, plist: string): ServiceControl {
  const domain = `gui/${uid}`
  return { kind: 'launchd', name: label, stop: ['/bin/sh', '-c', BOOTOUT, domain, label], start: ['launchctl', 'bootstrap', domain, plist] }
}

/** The service manager running this process; `null` — none it knows (`npm start` in a terminal). */
export async function serviceControl(root: string): Promise<ServiceControl | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await promisify(execFile)('tasklist', ['/svc', '/fo', 'csv', '/nh', '/fi', `PID eq ${process.ppid}`], { windowsHide: true })
      const launcher = launcherOf(stdout, process.env)
      if (launcher !== null) return autostartControl(launcher, launcherArgsOf(root, process.execPath, process.env))
      const name = windowsServiceOf(stdout)
      return name === null || !WINDOWS_NAME.test(name) ? null : windowsControl(name)
    }
    if (process.platform === 'linux') {
      const unit = systemdUnitOf(readFileSync('/proc/self/cgroup', 'utf8'))
      return unit === null ? null : systemdControl(unit)
    }
    if (process.platform === 'darwin') {
      const label = launchdLabelOf(process.env)
      const plist = label === null ? null : join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
      return label === null || plist === null || !existsSync(plist) ? null : launchdControl(label, userInfo().uid, plist)
    }
  } catch {
    return null
  }
  return null
}
