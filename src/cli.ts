#!/usr/bin/env node
// The `even-keel` command of the npm package (`bin` of package.json): see `usage` below.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import { hostArgsOf, hostDirOf, installAutostart, quitHost, registeredAutostart, uninstallAutostart } from './autostart.js'
import { commandOf, serviceScriptOf } from './cli-args.js'
import { home, root, source } from './locations.js'
import { samePath } from './paths.js'
import { autostartControl, launchdControl, systemdControl, windowsControl, type ServiceControl } from './updates/control.js'
import { fromNpxCache, globalPrefixOf } from './updates/prefix.js'
import { npm } from './updates/runner.js'
import { installed } from './updates/watcher.js'

const usage = `usage: even-keel [command]
  (none)      run Even Keel in this terminal; from npx: install it globally and install the service
  install     install the service: on Windows a start at sign-in with an icon in the tray, no administrator
  uninstall   remove the service; the package and the data folder stay
  update [v]  stop the service, install version v (default: latest) with npm, start it again
data folder: ${home}`

const { name, version } = installed(root)
const command = commandOf(process.argv.slice(2))

function run(command: string[], what: string): void {
  const error = attempt(command, what)
  if (error !== null) fail(error)
}

function attempt([program, ...args]: string[], what: string): string | null {
  const result = spawnSync(program!, args, { stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' && program === 'npm' })
  if (result.error !== undefined) return `${what}: ${result.error.message}`
  return result.status === 0 ? null : `${what} failed with code ${result.status}`
}

function fail(message: string): never {
  console.error(`even-keel: ${message}`)
  process.exit(1)
}

/** npx keeps the package in a cache it may clear: the service runs from a global install of the same version. */
function installGlobally(): void {
  console.log(`even-keel: installing ${name}@${version} globally, the service needs a folder npx does not clear`)
  // A host of an earlier install runs node from the global folder npm replaces.
  if (process.platform === 'win32') {
    const before = registeredAutostart()
    if (before !== null) quitHost(before.exe)
  }
  run(npm('install', '--global', `${name}@${version}`, '--no-audit', '--no-fund'), 'npm install --global')
  const [program, ...args] = npm('root', '--global')
  const modules = spawnSync(program!, args, { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' && program === 'npm' }).stdout.trim()
  run([process.execPath, join(modules, name, 'dist', 'src', 'cli.js'), 'install'], 'even-keel install')
}

function service(action: 'install' | 'uninstall'): void {
  if (process.platform === 'win32') {
    if (action === 'install') autostart()
    else removeWindows()
  } else {
    const [program, args] = serviceScriptOf(process.platform, root, action)
    run([program, ...args], `service/${action}`)
  }
  if (action === 'uninstall' && source === 'npm') console.log(`The package stays: npm uninstall --global ${name}. The data stays in ${home}.`)
}

/** `sc.exe qc` of the Windows service `install.ps1` registers; `null` — not installed. */
function windowsService(): string | null {
  const query = spawnSync('sc.exe', ['qc', 'EvenKeel', '5000'], { encoding: 'utf8', windowsHide: true })
  return query.status === 0 ? query.stdout : null
}

/** One Even Keel per machine: the service of `install.ps1` would take the same port. */
function autostart(): void {
  if (windowsService() !== null) fail('the Windows service EvenKeel is installed: remove it first with service\\uninstall.ps1 from PowerShell 7 as administrator')
  if (source === 'git') {
    // The running host holds esbuild's binary under node_modules: npm fails on it with EPERM.
    const before = registeredAutostart()
    if (before !== null) quitHost(before.exe)
    run(npm('install', '--no-audit', '--no-fund'), 'npm install')
    run(npm('run', 'build'), 'npm run build')
  }
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

/** The page's button waits for the chains first; this does not, it is for a service that is down or a page out of reach. */
function update(target: string): void {
  if (source === 'git') fail('this is a git checkout: update it with git pull, or with the button on the page')
  const prefix = globalPrefixOf(root, process.platform)
  if (prefix === null) fail(`${root} is not a global npm install: npm install --global ${name}@${target}`)
  const control = installedService()
  if (control !== null) run(control.stop, 'stopping the service')
  // A failed install leaves the version that was there: the service starts again either way.
  const error = attempt(npm('install', '--global', '--prefix', prefix, `${name}@${target}`, '--no-audit', '--no-fund'), 'npm install --global')
  if (control !== null) run(control.start, 'starting the service')
  if (error !== null) fail(error)
}

switch (command.command) {
  case 'help':
    if (command.error !== undefined) fail(`${command.error}\n${usage}`)
    console.log(usage)
    break
  case 'run':
    if (fromNpxCache(root)) installGlobally()
    else await import('./main.js')
    break
  case 'install':
    if (fromNpxCache(root)) installGlobally()
    else service('install')
    break
  case 'uninstall':
    service('uninstall')
    break
  case 'update':
    update(command.version)
    break
}
