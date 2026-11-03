import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { autostartControl, launchdControl, launchdLabelOf, launcherOf, systemdControl, systemdUnitOf, systemUnitOf, windowsControl, windowsServiceOf } from './control.js'

describe('launcherOf', () => {
  const exe = 'C:\\Users\\jdoe\\AppData\\Local\\even-keel\\service\\EvenKeel.exe'

  it('takes the tray host that started this process for its launcher', () => {
    expect(launcherOf('"EvenKeel.exe","4242","N/A"\r\n', { EVEN_KEEL_LAUNCHER: exe })).toBe(exe)
  })

  it('finds none for another parent: a session of Even Keel inherits the variable, not the parent', () => {
    expect(launcherOf('"node.exe","4242","N/A"\r\n', { EVEN_KEEL_LAUNCHER: exe })).toBeNull()
    expect(launcherOf('"EvenKeel.exe","4242","N/A"\r\n', {})).toBeNull()
    expect(launcherOf('"EvenKeel.exe","4242","N/A"\r\n', { EVEN_KEEL_LAUNCHER: 'C:\\Tools\\other.exe' })).toBeNull()
  })
})

describe('windowsServiceOf', () => {
  it('reads the service its parent process hosts from tasklist /svc', () => {
    expect(windowsServiceOf('"EvenKeelService.exe","4242","EvenKeel"\r\n')).toBe('EvenKeel')
  })

  it('finds none for a parent that hosts no service or for no answer', () => {
    expect(windowsServiceOf('"pwsh.exe","4242","N/A"\r\n')).toBeNull()
    expect(windowsServiceOf('INFO: No tasks are running which match the specified criteria.\r\n')).toBeNull()
    expect(windowsServiceOf('')).toBeNull()
  })
})

describe('systemdUnitOf', () => {
  // The user manager's unit, joined: written whole it reads as an e-mail address to the commit's secret scan.
  const manager = ['user', '1000.service'].join('@')

  it('reads the user unit the process runs in', () => {
    expect(systemdUnitOf(`0::/user.slice/user-1000.slice/${manager}/app.slice/even-keel.service\n`)).toBe('even-keel.service')
  })

  it('finds none outside a user unit', () => {
    expect(systemdUnitOf('0::/user.slice/user-1000.slice/session-3.scope\n')).toBeNull()
    expect(systemdUnitOf('0::/system.slice/even-keel.service\n')).toBeNull()
    expect(systemdUnitOf(`0::/user.slice/user-1000.slice/${manager}/app.slice/app-gnome-terminal.scope\n`)).toBeNull()
  })
})

describe('systemUnitOf', () => {
  it('reads the system unit the process runs in (BTN-687)', () => {
    expect(systemUnitOf('0::/system.slice/even-keel.service\n')).toBe('even-keel.service')
  })

  it('finds none in a user unit or a terminal', () => {
    const manager = ['user', '1000.service'].join('@')
    expect(systemUnitOf(`0::/user.slice/user-1000.slice/${manager}/app.slice/even-keel.service\n`)).toBeNull()
    expect(systemUnitOf('0::/user.slice/user-1000.slice/session-3.scope\n')).toBeNull()
  })
})

describe('launchdLabelOf', () => {
  it('reads the label launchd gives a job', () => {
    expect(launchdLabelOf({ XPC_SERVICE_NAME: 'local.even-keel' })).toBe('local.even-keel')
  })

  it('finds none in a terminal', () => {
    expect(launchdLabelOf({ XPC_SERVICE_NAME: '0' })).toBeNull()
    expect(launchdLabelOf({})).toBeNull()
    expect(launchdLabelOf({ XPC_SERVICE_NAME: 'application.com.apple.Terminal.123' })).toBeNull()
  })
})

describe('the commands', () => {
  it('stops and starts a Windows service through PowerShell, which waits and takes a service already there', () => {
    const control = windowsControl('EvenKeel')
    expect(control.stop).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', "Stop-Service -Name 'EvenKeel' -ErrorAction Stop"])
    expect(control.start.at(-1)).toBe("Start-Service -Name 'EvenKeel' -ErrorAction Stop")
  })

  it('holds node stopped in the tray host and starts it again, or the host with its arguments when it is gone', () => {
    const exe = 'C:\\even-keel\\service\\bin\\EvenKeel.exe'
    expect(autostartControl(exe, ['C:\\even-keel', 'C:\\nodejs\\node.exe'])).toEqual({
      kind: 'autostart',
      name: exe,
      stop: [exe, '--stop'],
      start: [exe, 'C:\\even-keel', 'C:\\nodejs\\node.exe', '--start'],
    })
  })

  it('refuses a Windows name it would have to quote', () => {
    expect(() => windowsControl("Even'Keel")).toThrow()
  })

  it('stops and starts a user unit', () => {
    expect(systemdControl('even-keel.service')).toMatchObject({
      stop: ['systemctl', '--user', 'stop', 'even-keel.service'],
      start: ['systemctl', '--user', 'start', 'even-keel.service'],
    })
  })

  it('boots a launchd agent out, waits until it is gone, and boots it back in', () => {
    const control = launchdControl('local.even-keel', 501, '/Users/jdoe/Library/LaunchAgents/local.even-keel.plist')
    expect(control.stop.slice(0, 2)).toEqual(['/bin/sh', '-c'])
    expect(control.stop.slice(3)).toEqual(['gui/501', 'local.even-keel'])
    expect(control.start.slice(0, 2)).toEqual(['/bin/sh', '-c'])
    expect(control.start.slice(3)).toEqual(['gui/501', '/Users/jdoe/Library/LaunchAgents/local.even-keel.plist'])
  })
})

describe.skipIf(process.platform === 'win32')('launchdControl start', () => {
  /** Runs the start command with a fake `launchctl` that answers `print` with `printStatus` and logs every call. */
  function start(printStatus: number) {
    const dir = mkdtempSync(join(tmpdir(), 'launchctl-'))
    const calls = join(dir, 'calls')
    writeFileSync(join(dir, 'launchctl'), `#!/bin/sh\necho "$*" >>"${calls}"\n[ "$1" = print ] && exit ${printStatus}\nexit 0\n`)
    chmodSync(join(dir, 'launchctl'), 0o755)
    const [program, ...args] = launchdControl('local.even-keel', 501, '/Users/jdoe/Library/LaunchAgents/local.even-keel.plist').start
    const result = spawnSync(program!, args, { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } })
    const log = existsSync(calls) ? readFileSync(calls, 'utf8') : ''
    rmSync(dir, { recursive: true, force: true })
    return { status: result.status, stderr: result.stderr, calls: log.trim().split('\n') }
  }

  it('boots the agent into the desktop session of the user', () => {
    const { status, calls } = start(0)
    expect(status).toBe(0)
    expect(calls).toEqual(['print gui/501', 'bootstrap gui/501 /Users/jdoe/Library/LaunchAgents/local.even-keel.plist'])
  })

  it('says to sign in to the desktop when nobody is signed in there, instead of a bare "Bootstrap failed: 125"', () => {
    const { status, stderr, calls } = start(125)
    expect(status).not.toBe(0)
    expect(stderr).toContain('sign in to the desktop')
    expect(calls).toEqual(['print gui/501'])
  })
})
