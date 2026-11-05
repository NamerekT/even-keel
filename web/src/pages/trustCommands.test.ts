import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { notice, type Notice } from '../../../src/notice/notice.js'
import { UntrustedCommands } from './TrustCommands.js'
import { trustCommandsOf } from './trustRecovery.js'

const place = { task: 'ABC-5', folder: 'D:/work/my repo', platform: 'win32', user: 'svc', service: false }
const render = (error: Notice | null) => renderToStaticMarkup(createElement(UntrustedCommands, { notice: error }))

describe('manual trust recovery', () => {
  it('uses the saved executable and managed account instead of terminal defaults', () => {
    const saved = { ...place, recovery: { binary: 'D:/checked cli/claude.exe', configDir: 'D:/accounts/one' } }
    expect(trustCommandsOf(saved).own).toBe("Set-Location -LiteralPath 'D:/work/my repo'; if ($?) { $env:CLAUDE_CONFIG_DIR = 'D:/accounts/one'; & 'D:/checked cli/claude.exe' }")
    expect(trustCommandsOf(JSON.parse(JSON.stringify(saved)))).toEqual(trustCommandsOf(saved))
    expect(render(notice('claude.untrusted', saved))).toContain('PowerShell')
  })

  it('clears an inherited account override for the global account', () => {
    const recovery = { binary: '/opt/checked cli/claude', configDir: null }
    expect(trustCommandsOf({ ...place, recovery }).own).toContain('Remove-Item Env:CLAUDE_CONFIG_DIR')
    const commands = trustCommandsOf({ ...place, platform: 'linux', service: true, recovery })
    expect(commands.own).toContain("env -u CLAUDE_CONFIG_DIR '/opt/checked cli/claude'")
    expect(commands.as).toContain("sudo -u 'svc' -H env -u CLAUDE_CONFIG_DIR '/opt/checked cli/claude'")
  })

  it.each(['linux', 'darwin'])('pins and quotes the managed account on %s', (platform) => {
    const recovery = { binary: "/opt/team's cli/claude", configDir: "/accounts/team's folder" }
    const commands = trustCommandsOf({ ...place, platform, service: true, recovery })
    expect(commands.own).toContain("env CLAUDE_CONFIG_DIR='/accounts/team'\\''s folder' '/opt/team'\\''s cli/claude'")
    expect(commands.as).toContain("sudo -u 'svc' -H env CLAUDE_CONFIG_DIR=")
  })

  it('protects Windows paths from cmd expansion and runas quoting', () => {
    const recovery = { binary: 'D:/%PATH%/cli & tools/claude.exe', configDir: "D:/accounts/one's !folder" }
    const commands = trustCommandsOf({ ...place, folder: 'D:/repo & stuff', service: true, recovery })
    expect(commands.own).toContain("& 'D:/%PATH%/cli & tools/claude.exe'")
    expect(commands.own).toContain("$env:CLAUDE_CONFIG_DIR = 'D:/accounts/one''s !folder'")
    expect(commands.as).toContain('Start-Process runas.exe')
    expect(commands.as).toContain('/user:svc')
    expect(commands.as).toContain('D:/%PATH%/cli & tools/claude.exe')
    expect(commands.as).toContain('D:/accounts/one')
    expect(commands.as).not.toContain('EncodedCommand')
  })

  it('preserves non-BMP characters in readable Windows commands', () => {
    const commands = trustCommandsOf({ ...place, folder: 'D:/repo-%-🚢', recovery: { binary: 'D:/claude.exe', configDir: null } })
    expect(commands.own).toContain('🚢')
  })

  it('passes a service user with spaces or cmd expansions literally', () => {
    const commands = trustCommandsOf({ ...place, service: true, user: 'service %example% user', recovery: { binary: 'D:/claude.exe', configDir: null } })
    expect(commands.as).toContain('/user:service %example% user')
    expect(commands.as).not.toContain('EncodedCommand')
  })

  it('preserves old commands when the saved context is absent or incomplete', () => {
    for (const recovery of [undefined, { binary: 'D:/cli.exe' }, { binary: '', configDir: null }, { binary: 'D:/cli.exe', configDir: '' }]) {
      expect(trustCommandsOf({ ...place, recovery } as Parameters<typeof trustCommandsOf>[0])).toEqual(trustCommandsOf(place))
    }
  })

  it('shows a copyable cmd command only for a CLI trust refusal', () => {
    const html = render(notice('claude.untrusted', place))
    expect(html).toContain('pushd &quot;D:/work/my repo&quot; &amp;&amp; claude')
    expect(html).not.toContain('runas')
    expect(render(notice('claude.trustWriteFailed', { folder: place.folder }))).toBe('')
    expect(render(notice('claude.startFailed', { task: place.task, cwd: place.folder }))).toBe('')
    expect(render(null)).toBe('')
  })

  it('includes the service user command and preserves the legacy service fallback', () => {
    expect(render(notice('claude.untrusted', { ...place, service: true }))).toContain('runas /user:svc')
    const { service: _, ...legacy } = place
    expect(render(notice('claude.untrusted', legacy))).toContain('runas /user:svc')
  })

  it('finds refusals in stored nested causes and items', () => {
    const refusal = notice('claude.untrusted', place)
    const wrapper = notice('chain.empty', { project: 'ABC' }, { cause: refusal })
    expect(render(wrapper)).toBe(render(refusal))
    expect(render(notice('chain.empty', { project: 'ABC' }, { items: [wrapper] }))).toBe(render(refusal))
    expect(render(JSON.parse(JSON.stringify(wrapper)))).toBe(render(wrapper))
  })

  it.each(['linux', 'darwin'])('quotes shell paths and service users on %s', (platform) => {
    const html = render(notice('claude.untrusted', { ...place, platform, folder: "/work/team's repo", service: true }))
    expect(html).toContain('sudo -u &#x27;svc&#x27; -H claude')
    expect(html).toContain('team&#x27;\\&#x27;&#x27;s repo')
    expect(html).not.toContain('runas')
  })
})
