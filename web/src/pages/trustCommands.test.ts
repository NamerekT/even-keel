import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { notice, type Notice } from '../../../src/notice/notice.js'
import { UntrustedCommands } from './TrustCommands.js'
import { trustCommandsOf } from './trustRecovery.js'

const place = { task: 'ABC-5', folder: 'D:/work/my repo', platform: 'win32', user: 'svc', service: false }
const render = (error: Notice | null) => renderToStaticMarkup(createElement(UntrustedCommands, { notice: error }))
const commands = (where: Parameters<typeof trustCommandsOf>[0]) => trustCommandsOf(where).map((each) => each.command)
const only = (where: Parameters<typeof trustCommandsOf>[0]) => {
  const shown = commands(where)
  expect(shown).toHaveLength(1)
  return shown[0]!
}

describe('manual trust recovery', () => {
  it('uses the saved executable and managed account instead of terminal defaults', () => {
    const saved = { ...place, recovery: { binary: 'D:/checked cli/claude.exe', configDir: 'D:/accounts/one' } }
    expect(only(saved)).toBe("Set-Location -LiteralPath 'D:/work/my repo'; if ($?) { $env:CLAUDE_CONFIG_DIR = 'D:/accounts/one'; & 'D:/checked cli/claude.exe' }")
    expect(trustCommandsOf(JSON.parse(JSON.stringify(saved)))).toEqual(trustCommandsOf(saved))
    expect(render(notice('claude.untrusted', saved))).toContain('<p>PowerShell</p>')
  })

  it('clears an inherited account override for the global account', () => {
    const recovery = { binary: '/opt/checked cli/claude', configDir: null }
    expect(only({ ...place, recovery })).toContain('Remove-Item Env:CLAUDE_CONFIG_DIR')
    expect(only({ ...place, platform: 'linux', recovery })).toContain("env -u CLAUDE_CONFIG_DIR '/opt/checked cli/claude'")
    expect(only({ ...place, platform: 'linux', service: true, recovery })).toContain("sudo -u 'svc' -H env -u CLAUDE_CONFIG_DIR '/opt/checked cli/claude'")
  })

  it.each(['linux', 'darwin'])('pins and quotes the managed account on %s', (platform) => {
    const recovery = { binary: "/opt/team's cli/claude", configDir: "/accounts/team's folder" }
    expect(only({ ...place, platform, recovery })).toContain("env CLAUDE_CONFIG_DIR='/accounts/team'\\''s folder' '/opt/team'\\''s cli/claude'")
    expect(only({ ...place, platform, service: true, recovery })).toContain("sudo -u 'svc' -H env CLAUDE_CONFIG_DIR=")
  })

  it("runs the service's script through runas: a short line in cmd, no nested PowerShell (EKR-87)", () => {
    const recovery = { binary: 'D:/%PATH%/cli & tools/claude.exe', configDir: "D:/accounts/one's !folder" }
    const service = { ...place, folder: 'D:/repo & stuff', service: true, recovery }
    expect(trustCommandsOf({ ...service, script: 'D:\\even-keel\\state\\trust\\ABC-5.ps1' })).toEqual([{
      command: 'runas /user:svc "powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File D:\\even-keel\\state\\trust\\ABC-5.ps1"', shell: 'cmd', as: 'svc',
    }])
    expect(only({ ...service, script: 'C:\\Even Keel\\state\\trust\\ABC-5.ps1' }))
      .toBe('runas /user:svc "powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File \\"C:\\Even Keel\\state\\trust\\ABC-5.ps1\\""')
    expect(only({ ...service, user: 'service %example% user', script: 'D:\\s.ps1' })).toMatch(/^runas "\/user:service %example% user" /)
    const html = render(notice('claude.untrusted', { ...service, script: 'D:\\s.ps1' }))
    expect(html).toContain('<p>cmd</p>')
    expect(html).not.toContain('svc</p>')
  })

  it('keeps the escaped Start-Process line for a service pause saved before the script', () => {
    const recovery = { binary: 'D:/%PATH%/cli & tools/claude.exe', configDir: "D:/accounts/one's !folder" }
    const line = only({ ...place, folder: 'D:/repo & stuff', service: true, recovery })
    expect(line).toContain('Start-Process runas.exe')
    expect(line).toContain('/user:svc')
    expect(line).toContain('D:/%PATH%/cli & tools/claude.exe')
    expect(line).not.toContain('EncodedCommand')
    expect(only({ ...place, service: true, user: 'service %example% user', recovery: { binary: 'D:/claude.exe', configDir: null } })).toContain('/user:service %example% user')
  })

  it('preserves non-BMP characters in readable Windows commands', () => {
    expect(only({ ...place, folder: 'D:/repo-%-🚢', recovery: { binary: 'D:/claude.exe', configDir: null } })).toContain('🚢')
  })

  it('preserves old commands when the saved context is absent or incomplete', () => {
    for (const recovery of [undefined, { binary: 'D:/cli.exe' }, { binary: '', configDir: null }, { binary: 'D:/cli.exe', configDir: '' }]) {
      expect(trustCommandsOf({ ...place, recovery } as Parameters<typeof trustCommandsOf>[0])).toEqual(trustCommandsOf(place))
    }
  })

  it('shows one copyable command, labelled only by its shell, and only for a CLI trust refusal', () => {
    const html = render(notice('claude.untrusted', place))
    expect(html).toContain('<p>cmd</p>')
    expect(html).toContain('pushd &quot;D:/work/my repo&quot; &amp;&amp; claude')
    expect(html).not.toContain('runas')
    expect(render(notice('claude.trustWriteFailed', { folder: place.folder }))).toBe('')
    expect(render(notice('claude.startFailed', { task: place.task, cwd: place.folder }))).toBe('')
    expect(render(null)).toBe('')
  })

  it('gives only the service user command under a service, and both, named, to a pause saved before Even Keel knew', () => {
    expect(only({ ...place, service: true })).toBe('runas /user:svc "cmd /k cd /d D:/work/my repo && claude"')
    const { service: _, ...legacy } = place
    expect(commands(legacy)).toEqual(['pushd "D:/work/my repo" && claude', 'runas /user:svc "cmd /k cd /d D:/work/my repo && claude"'])
    expect(render(notice('claude.untrusted', legacy))).toContain('<p>cmd · as svc</p>')
  })

  it('finds refusals in stored nested causes and items', () => {
    const refusal = notice('claude.untrusted', place)
    const wrapper = notice('chain.empty', { project: 'ABC' }, { cause: refusal })
    expect(render(wrapper)).toBe(render(refusal))
    expect(render(notice('chain.empty', { project: 'ABC' }, { items: [wrapper] }))).toBe(render(refusal))
    expect(render(JSON.parse(JSON.stringify(wrapper)))).toBe(render(wrapper))
  })

  it.each(['linux', 'darwin'])('quotes shell paths and service users on %s, with no label', (platform) => {
    const html = render(notice('claude.untrusted', { ...place, platform, folder: "/work/team's repo", service: true }))
    expect(html).toContain('sudo -u &#x27;svc&#x27; -H claude')
    expect(html).toContain('team&#x27;\\&#x27;&#x27;s repo')
    expect(html).not.toContain('runas')
    expect(html).not.toContain('<p>')
  })
})
