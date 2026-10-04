import { describe, expect, it } from 'vitest'
import { vscodeSettingsFile } from './vscode.js'

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
