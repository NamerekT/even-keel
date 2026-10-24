// The autostart at sign-in on Windows (BTN-372): the tray host `EvenKeel.exe` in the user's `Run` key, set up and
// removed by `even-keel install`/`uninstall` (`src/cli.ts`) with no administrator and no PowerShell 7.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { win32 } from 'node:path'
import type { InstallSource } from './updates/model.js'
import { LAUNCHER_EXE } from './updates/control.js'

export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
export const RUN_VALUE = 'EvenKeel'
const SOURCES = ['EvenKeelService.cs', 'EvenKeelHost.cs', 'EvenKeelTray.cs']
const REFERENCES = ['System.ServiceProcess.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll', 'System.Web.Extensions.dll']

export interface Autostart {
  exe: string
  root: string
  node: string
  /** The data folder of a package, which the host passes on as `EVEN_KEEL_DATA`; `null` — a checkout keeps its own. */
  data: string | null
}

/** Where the host goes, as `install.ps1` puts the service's: a checkout's `service\bin`, a package's `<data>\service`, since npm replaces the package's folder. */
export function hostDirOf(root: string, source: InstallSource, home: string): string {
  return source === 'git' ? win32.join(root, 'service', 'bin') : win32.join(home, 'service')
}

/** The host's arguments after its exe. */
export function hostArgsOf({ root, node, data }: Autostart): string[] {
  return data === null ? [root, node] : [root, node, data]
}

/** The `Run` value: the host in its tray mode. */
export function runCommandOf(autostart: Autostart): string {
  return [autostart.exe, ...hostArgsOf(autostart)].map((arg) => `"${arg}"`).join(' ') + ' --tray'
}

/** The value of `reg query <Run> /v EvenKeel`; `null` — none, or one this did not write. */
export function autostartOf(query: string): Autostart | null {
  const value = new RegExp(`^\\s*${RUN_VALUE}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'm').exec(query)?.[1]?.trim()
  if (value === undefined || !value.endsWith(' --tray')) return null
  const args = [...value.matchAll(/"([^"]*)"/g)].map((match) => match[1]!)
  const [exe, root, node, data] = args
  if (exe === undefined || root === undefined || node === undefined || args.length > 4) return null
  return win32.basename(exe).toLowerCase() === LAUNCHER_EXE.toLowerCase() ? { exe, root, node, data: data ?? null } : null
}

/** `quiet` drops the output, an error message stays: `reg.exe` reports every success. */
function attempt([program, ...args]: string[], what: string, quiet = false): void {
  const result = spawnSync(program!, args, { stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit', windowsHide: true })
  if (result.error !== undefined) throw new Error(`${what}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${what} failed with code ${result.status}`)
}

/** The autostart the user's `Run` key holds; `null` — none. */
export function registeredAutostart(): Autostart | null {
  const query = spawnSync('reg.exe', ['query', RUN_KEY, '/v', RUN_VALUE], { encoding: 'utf8', windowsHide: true })
  return query.status === 0 ? autostartOf(query.stdout) : null
}

/** Ends a running host and its node; none running is no error. */
export function quitHost(exe: string): void {
  if (existsSync(exe)) attempt([exe, '--quit'], `${LAUNCHER_EXE} --quit`)
}

/**
 * Compiles the host with the `csc.exe` of .NET Framework into `dir`, writes the `Run` value and starts the host. A host
 * already running is ended first: it holds the exe the compiler replaces.
 */
export function installAutostart(root: string, node: string, data: string | null, dir: string): Autostart {
  const autostart: Autostart = { exe: win32.join(dir, LAUNCHER_EXE), root, node, data }
  const before = registeredAutostart()
  if (before !== null) quitHost(before.exe)
  quitHost(autostart.exe)
  const csc = win32.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  if (!existsSync(csc)) throw new Error(`${csc} is missing: the host needs .NET Framework 4, which comes with Windows`)
  mkdirSync(dir, { recursive: true })
  const sources = SOURCES.map((file) => win32.join(root, 'service', file))
  attempt([csc, '-nologo', '-target:winexe', `-out:${autostart.exe}`, ...REFERENCES.map((dll) => `-reference:${dll}`), ...sources], 'csc')
  attempt(['reg.exe', 'add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', runCommandOf(autostart), '/f'], 'reg add', true)
  attempt([autostart.exe, ...hostArgsOf(autostart), '--start'], `${LAUNCHER_EXE} --start`)
  return autostart
}

/** Ends the host, removes the `Run` value and the host's exe; the folder too once nothing else is in it (`install.ps1` puts the service's host there). */
export function uninstallAutostart(autostart: Autostart): void {
  quitHost(autostart.exe)
  attempt(['reg.exe', 'delete', RUN_KEY, '/v', RUN_VALUE, '/f'], 'reg delete', true)
  rmSync(autostart.exe, { force: true })
  const dir = win32.dirname(autostart.exe)
  if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true })
}
