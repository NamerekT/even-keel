#!/usr/bin/env node
// The `even-keel` command of the npm package (`bin` of package.json): see `usage` below.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { hostArgsOf, hostDirOf, installAutostart, quitHost, registeredAutostart, uninstallAutostart } from './autostart.js'
import { commandOf, installArgsOf, noServiceManagerCode, serviceScriptOf, updateTargetOf, type InstallOptions, type MachineJoin } from './cli-args.js'
import { contactMessageOf, prerequisiteRefusal, waitForContact } from './cli-install.js'
import { browserCommandOf, opensBrowser, pageAddressOf, pageLogOf, pageMessageOf, waitForPage, type PageWait } from './cli-page.js'
import { home, inContainer, loadEnv, root, source, stateDirOf } from './locations.js'
import { UPDATE_BLOCKS } from './notice/en-values.js'
import { accountsRoot } from './account/homes.js'
import { removeAccountSettingsGuards } from './account/settingsGuard.js'
import { globalBinOf, isAccessError, loginShell, nearestExisting, npmPrefixAdvice, rootRefusal, writable } from './npm-access.js'
import { samePath } from './paths.js'
import { autostartControl, launchdControl, systemdControl, windowsControl, type ServiceControl } from './updates/control.js'
import { fromNpxCache, globalPrefixOf } from './updates/prefix.js'
import { npm } from './updates/runner.js'
import { installed } from './updates/watcher.js'

const usage = `usage: even-keel [command]
  (none)      run Even Keel in this terminal; from npx: install it globally and install the service
  install [--machine <string> [--root <folder>]] [--service]
              install the service: on Windows a start at sign-in with an icon in the tray, no administrator;
              --service: the Windows service EvenKeel instead, from PowerShell 7 as administrator; --machine:
              join the hub first (as join below) and run as its machine, with no page of its own
  uninstall   remove the service; the package and the data folder stay
  update [v]  stop the service, install version v with npm, start it again; with no v the newest of the
              dist-tag latest and, for a release candidate, next; nothing when none is newer
  join <string> [--root <folder>]
              make this installation a machine of a hub: the string is the hub's connection string, the folder
              the one its projects go into (by default projects/ in the data folder); stop the service first
  status      whether this installation is a machine, of which hub, and when it last heard the hub
data folder: ${home}`

const { name, version: installedVersion } = installed(root)
const command = commandOf(process.argv.slice(2))

/**
 * `explained` — an exit code after which the command has already said why: this process exits with it, adding nothing
 * but what `beforeExit` prints.
 */
function run(command: string[], what: string, explained?: number, beforeExit?: () => void): void {
  const error = attempt(command, what, explained, beforeExit)
  if (error !== null) fail(error)
}

function attempt([program, ...args]: string[], what: string, explained?: number, beforeExit?: () => void): string | null {
  const result = spawnSync(program!, args, { stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' && program === 'npm' })
  if (result.error !== undefined) return `${what}: ${result.error.message}`
  if (explained !== undefined && result.status === explained) {
    beforeExit?.()
    process.exit(explained)
  }
  return result.status === 0 ? null : `${what} failed with code ${result.status}`
}

/** Any HTTP answer of the page, whatever its status; a refused or hung connection rejects. */
const pageWait: PageWait = {
  request: async (url) => {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2_000) })
    await response.body?.cancel()
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * The page's address from the data folder's `.env`. Read only after the service is installed: `install.sh` writes the
 * listen variables of its environment into the unit, and `.env`'s must not get there.
 */
function pageAddress(): ReturnType<typeof pageAddressOf> {
  loadEnv()
  return pageAddressOf(process.env)
}

/** Once the service is started: waits up to 30 s for its page and says where it is. Whether the page answered. */
async function announcePage(): Promise<boolean> {
  const address = pageAddress()
  if ('error' in address) {
    console.log(pageMessageOf({ kind: 'unknown', error: address.error }))
    return false
  }
  const answered = await waitForPage(address.url, pageWait)
  console.log(pageMessageOf(answered ? { kind: 'ready', url: address.url } : { kind: 'silent', url: address.url, log: pageLogOf(process.platform, home) }))
  return answered
}

/** Linux without a systemd user manager: no service to wait for, only where its page will be. */
function announceNoService(): void {
  const address = pageAddress()
  console.log(pageMessageOf('error' in address ? { kind: 'unknown', error: address.error } : { kind: 'noService', url: address.url }))
}

/** Opens the page in the default browser; a failure is silent, the address is already printed. */
function openBrowser(url: string): void {
  const command = browserCommandOf(process.platform, url)
  if (command === null) return
  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // No opener here.
  }
}

/** Node 24 for any install, git for a machine: refused before anything is installed. */
function checkPrerequisites(machine: boolean): void {
  const git = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true })
  const refusal = prerequisiteRefusal({ node: process.versions.node, git: git.status === 0 ? git.stdout.trim() : null, machine, container: inContainer })
  if (refusal !== null) fail(refusal)
}

function fail(message: string): never {
  console.error(`even-keel: ${message}`)
  process.exit(1)
}

/** `attempt` that also keeps stderr, shown as it comes: an EACCES of npm there adds the advice. */
function attemptKeepingErrors([program, ...args]: string[], what: string): Promise<{ error: string | null; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = ''
    const child = spawn(program!, args, { stdio: ['inherit', 'inherit', 'pipe'], windowsHide: true, shell: process.platform === 'win32' && program === 'npm' })
    child.stderr!.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
      stderr = (stderr + chunk.toString()).slice(-8_000)
    })
    child.on('error', (error) => resolve({ error: `${what}: ${error.message}`, stderr }))
    child.on('close', (code) => resolve({ error: code === 0 ? null : `${what} failed with code ${code}`, stderr }))
  })
}

/** The stdout of an npm command that prints a value. */
function npmOutput(...command: string[]): string {
  const [program, ...args] = npm(...command)
  const what = `npm ${command[0]}`
  const result = spawnSync(program!, args, { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' && program === 'npm' })
  if (result.error !== undefined) fail(`${what}: ${result.error.message}`)
  if (result.status !== 0) fail(`${what} failed with code ${result.status}: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

function shell(): string | undefined {
  return loginShell(process.env.SHELL, () => userInfo().shell)
}

/** npx keeps the package in a cache it may clear: the service runs from a global install of the same version. */
async function installGlobally(options: InstallOptions): Promise<void> {
  const npx = `npx ${name}@${installedVersion}`
  const refusal = rootRefusal(process.platform, process.getuid?.(), npx)
  if (refusal !== null) fail(refusal)
  const modules = npmOutput('root', '--global')
  const posix = process.platform !== 'win32'
  if (posix) {
    const blocked = [modules, globalBinOf(modules)].filter((folder) => folder !== null).map((folder) => nearestExisting(folder, existsSync)).find((folder) => !writable(folder))
    if (blocked !== undefined) fail(npmPrefixAdvice(blocked, shell(), npx))
  }
  console.log(`even-keel: installing ${name}@${installedVersion} globally, the service needs a folder npx does not clear`)
  // A host of an earlier install runs node from the global folder npm replaces.
  if (!posix) {
    const before = registeredAutostart()
    if (before !== null) quitHost(before.exe)
  }
  const { error, stderr } = await attemptKeepingErrors(npm('install', '--global', `${name}@${installedVersion}`, '--no-audit', '--no-fund'), 'npm install --global')
  if (error !== null) fail(posix && isAccessError(stderr) ? `${error}\n${npmPrefixAdvice(modules, shell(), npx)}` : error)
  // The global copy waits for the page and prints its address; the browser opens only at this first install.
  run([process.execPath, join(modules, name, 'dist', 'src', 'cli.js'), 'install', ...installArgsOf(options)], 'even-keel install', noServiceManagerCode)
  // A machine has no page, and the Windows service waits for its password in services.msc.
  if (options.machine !== null || options.service) return
  const address = pageAddress()
  if ('error' in address) return
  const responded = await waitForPage(address.url, { ...pageWait, timeoutMs: 0 })
  if (opensBrowser({ platform: process.platform, env: process.env, firstInstall: true, responded })) openBrowser(address.url)
}

/** A machine joins inside the script on Linux and macOS and with `--service`, here for the start at sign-in. */
async function install({ machine, service }: InstallOptions): Promise<void> {
  const startedAt = Date.now()
  if (process.platform === 'win32' && !service) await autostart(machine)
  else {
    const [program, args] = serviceScriptOf(process.platform, root, 'install', machine)
    run([program, ...args], 'service/install', noServiceManagerCode, machine === null ? announceNoService : undefined)
    // install.ps1 has said what is left: the password in services.msc, or where the log is.
    if (service) return
  }
  if (machine === null) await announcePage()
  else await announceContact(startedAt)
}

/**
 * `even-keel join` in its own process: it reads the data folder's `.env`, which must not get into this one's
 * environment and from there into the host or the unit.
 */
function joinInChild({ line, root: projects }: MachineJoin): void {
  run([process.execPath, join(root, 'dist', 'src', 'cli.js'), 'join', line, ...(projects === null ? [] : ['--root', projects])], 'even-keel join', 1)
}

/** Once a machine's service is started: waits up to 30 s for its first contact with the hub; `false` — this is no machine. */
async function announceContact(since: number): Promise<boolean> {
  loadEnv()
  const { readLinkFile } = await import('./machine/join.js')
  const stateDir = stateDirOf()
  const file = readLinkFile(stateDir)
  if (file === undefined) return false
  const reached = await waitForContact(() => readLinkFile(stateDir), since, pageWait)
  console.log(contactMessageOf(reached, file.hub, pageLogOf(process.platform, home)))
  return true
}

async function uninstall(): Promise<void> {
  if (process.platform === 'win32') removeWindows()
  else {
    const [program, args] = serviceScriptOf(process.platform, root, 'uninstall')
    run([program, ...args], 'service/uninstall')
  }
  loadEnv()
  removeAccountSettingsGuards(accountsRoot(process.env), process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'))
  if (source === 'npm') console.log(`The package stays: npm uninstall --global ${name}. The data stays in ${home}.`)
}

/** `sc.exe qc` of the Windows service `install.ps1` registers; `null` — not installed. */
function windowsService(): string | null {
  const query = spawnSync('sc.exe', ['qc', 'EvenKeel', '5000'], { encoding: 'utf8', windowsHide: true })
  return query.status === 0 ? query.stdout : null
}

/** One Even Keel per machine: the service of `install.ps1` would take the same port. */
async function autostart(machine: MachineJoin | null): Promise<void> {
  if (windowsService() !== null) fail('the Windows service EvenKeel is installed: remove it first with service\\uninstall.ps1 from PowerShell 7 as administrator')
  if (source === 'git') {
    // The running host holds esbuild's binary under node_modules: npm fails on it with EPERM.
    const before = registeredAutostart()
    if (before !== null) quitHost(before.exe)
    run(npm('install', '--no-audit', '--no-fund'), 'npm install')
    // A machine has no page: the server's code is enough.
    run(npm('run', machine === null ? 'build' : 'build:machine'), `npm run ${machine === null ? 'build' : 'build:machine'}`)
  }
  if (machine !== null) joinInChild(machine)
  const data = source === 'npm' ? home : null
  try {
    const { exe } = installAutostart(root, process.execPath, data, hostDirOf(root, source, home))
    console.log(`Even Keel starts at your sign-in and runs now, with its icon in the tray: ${exe}`)
    console.log(`Log: ${join(home, 'logs', 'even-keel.log')}`)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

function removeWindows(): void {
  const registered = registeredAutostart()
  if (registered !== null) {
    try {
      uninstallAutostart(registered)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    console.log('Even Keel no longer starts at sign-in.')
  }
  if (windowsService() !== null) {
    const [program, args] = serviceScriptOf(process.platform, root, 'uninstall')
    run([program, ...args], 'service/uninstall')
  } else if (registered === null) console.log('Even Keel is not installed to start by itself.')
}

/** The service install.ps1 or install.sh registered for this package, or the autostart; `null` — none, or one running another folder. */
function installedService(): ServiceControl | null {
  if (process.platform === 'win32') {
    const registered = registeredAutostart()
    if (registered !== null && samePath(registered.root, root)) return autostartControl(registered.exe, hostArgsOf(registered))
    const query = windowsService()
    return query !== null && query.includes(root) ? windowsControl('EvenKeel') : null
  }
  const registered = (file: string) => existsSync(file) && readFileSync(file, 'utf8').includes(root)
  if (process.platform === 'linux') {
    const unit = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'even-keel.service')
    return registered(unit) ? systemdControl('even-keel.service') : null
  }
  if (process.platform === 'darwin') {
    const plist = join(homedir(), 'Library', 'LaunchAgents', 'local.even-keel.plist')
    return registered(plist) ? launchdControl('local.even-keel', userInfo().uid, plist) : null
  }
  return null
}

/** The dist-tags of the package in the registry, `npm view <name> dist-tags --json`. */
function distTags(): Record<string, unknown> {
  const stdout = npmOutput('view', name, 'dist-tags', '--json')
  try {
    const tags: unknown = JSON.parse(stdout)
    if (tags !== null && typeof tags === 'object' && !Array.isArray(tags)) return tags as Record<string, unknown>
  } catch {
    // Reported below with the output.
  }
  fail(`npm view gave no dist-tags: ${stdout}`)
}

/** The page's button waits for the chains first; this does not, it is for a service that is down or a page out of reach. */
async function update(version: string | null): Promise<void> {
  if (inContainer) fail(UPDATE_BLOCKS.container)
  if (source === 'git') fail('this is a git checkout: update it with git pull, or with the button on the page')
  const prefix = globalPrefixOf(root, process.platform)
  if (prefix === null) fail(`${root} is not a global npm install: npm install --global ${name}@${version ?? 'latest'}`)
  const target = version ?? updateTargetOf(installedVersion, distTags())
  if (target === null) {
    console.log(`even-keel: ${installedVersion} is already the latest version`)
    return
  }
  const control = installedService()
  const startedAt = Date.now()
  if (control !== null) {
    console.log('even-keel: stopping the service')
    run(control.stop, 'stopping the service')
  }
  console.log(`even-keel: updating ${installedVersion} to ${target}`)
  // A failed install leaves the version that was there: the service starts again either way.
  const error = attempt(npm('install', '--global', '--prefix', prefix, `${name}@${target}`, '--no-audit', '--no-fund'), 'npm install --global')
  if (control !== null) {
    console.log('even-keel: starting the service')
    run(control.start, 'starting the service')
  }
  if (error !== null) {
    console.error(`even-keel: ${installedVersion} stays`)
    fail(error)
  }
  if (control === null) console.log(`even-keel: updated to ${target}; no service of this install, so none was started`)
  // A machine of a hub has no page: it says whether it reached the hub instead (BTN-994).
  else if (!(await announceContact(startedAt))) await announcePage()
}

switch (command.command) {
  case 'help':
    if (command.error !== undefined) fail(`${command.error}\n${usage}`)
    console.log(usage)
    break
  case 'run':
    if (fromNpxCache(root)) {
      checkPrerequisites(false)
      await installGlobally({ machine: null, service: false })
    } else await import('./main.js')
    break
  case 'install': {
    const options: InstallOptions = { machine: command.machine, service: command.service }
    checkPrerequisites(options.machine !== null)
    if (options.service && process.platform !== 'win32') fail('--service is the Windows service EvenKeel; on Linux and macOS install is always a service of your user')
    if (fromNpxCache(root)) await installGlobally(options)
    else await install(options)
    break
  }
  case 'uninstall':
    await uninstall()
    break
  case 'update':
    await update(command.version)
    break
  case 'join': {
    loadEnv()
    const { joinFromCli } = await import('./machine/join-cli.js')
    const joined = await joinFromCli(command.line, command.root, installedVersion)
    if (typeof joined === 'string') fail(joined)
    console.log(joined.join('\n'))
    break
  }
  case 'status': {
    loadEnv()
    const { readLinkFile, statusLines } = await import('./machine/join.js')
    console.log(statusLines(readLinkFile(stateDirOf()), Date.now()).join('\n'))
    break
  }
}
