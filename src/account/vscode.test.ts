import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VsCodeAccount, vscodeSettingsFile } from './vscode.js'

describe('vscodeSettingsFile', () => {
  it('looks in APPDATA on Windows', () => {
    expect(vscodeSettingsFile({ APPDATA: 'D:\\Roaming' }, 'win32', 'C:\\Users\\john')).toBe('D:\\Roaming\\Code\\User\\settings.json')
  })

  it('falls back to the roaming folder of the profile on Windows', () => {
    expect(vscodeSettingsFile({}, 'win32', 'C:\\Users\\john')).toBe('C:\\Users\\john\\AppData\\Roaming\\Code\\User\\settings.json')
  })

  it('looks in Application Support on macOS', () => {
    expect(vscodeSettingsFile({}, 'darwin', '/Users/john')).toBe('/Users/john/Library/Application Support/Code/User/settings.json')
  })

  it('looks in XDG_CONFIG_HOME on Linux, ~/.config without it', () => {
    expect(vscodeSettingsFile({ XDG_CONFIG_HOME: '/home/john/cfg' }, 'linux', '/home/john')).toBe('/home/john/cfg/Code/User/settings.json')
    expect(vscodeSettingsFile({}, 'linux', '/home/john')).toBe('/home/john/.config/Code/User/settings.json')
  })

  it('has no file on other systems', () => {
    expect(vscodeSettingsFile({}, 'freebsd', '/home/john')).toBeNull()
  })
})

describe('VsCodeAccount', () => {
  const folders: string[] = []
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })

  function account(file: string): VsCodeAccount {
    return new VsCodeAccount({
      file,
      homes: () => [],
      ownerOf: (dir) => (dir === null ? 'global' : undefined),
      records: async () => [],
      title: async () => null,
      intervalMs: 1000,
      onChange: () => {},
      onError: () => {},
    })
  }

  function settingsFile(): string {
    const folder = mkdtempSync(join(tmpdir(), 'vscode-'))
    folders.push(folder)
    return join(folder, 'settings.json')
  }

  it('sits on no account where VS Code has no settings file', async () => {
    const app = account(settingsFile())
    await app.refresh()
    expect(app.view).toMatchObject({ account: null, dir: null, error: null })
  })

  it('sits on the global folder when the settings file has no CLAUDE_CONFIG_DIR', async () => {
    const file = settingsFile()
    writeFileSync(file, '{ "editor.fontSize": 14 }\n')
    const app = account(file)
    await app.refresh()
    expect(app.view).toMatchObject({ account: 'global', dir: null, error: null })
  })
})
