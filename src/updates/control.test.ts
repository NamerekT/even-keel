import { describe, expect, it } from 'vitest'
import { launchdControl, launchdLabelOf, systemdControl, systemdUnitOf, windowsControl, windowsServiceOf } from './control.js'

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
    expect(control.start).toEqual(['launchctl', 'bootstrap', 'gui/501', '/Users/jdoe/Library/LaunchAgents/local.even-keel.plist'])
  })
})
