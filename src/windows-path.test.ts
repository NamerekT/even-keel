import { describe, expect, it } from 'vitest'
import { MACHINE_ENVIRONMENT, USER_ENVIRONMENT, addedPath, refreshWindowsPath, registryPathOf } from './windows-path.js'

const answer = (type: string, value: string) => `\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment\r\n    Path    ${type}    ${value}\r\n\r\n`

describe('registryPathOf', () => {
  it('expands the %VAR%s of a REG_EXPAND_SZ value, whatever their case, and keeps an unknown one as Windows does', () => {
    const env = { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\john' }
    expect(registryPathOf(answer('REG_EXPAND_SZ', '%SystemRoot%\\system32;%systemroot%;%NOPE%\\bin;%USERPROFILE%\\.local\\bin'), env)).toEqual([
      'C:\\Windows\\system32',
      'C:\\Windows',
      '%NOPE%\\bin',
      'C:\\Users\\john\\.local\\bin',
    ])
  })

  it('leaves a REG_SZ value unexpanded and drops empty entries', () => {
    expect(registryPathOf(answer('REG_SZ', '%SystemRoot%;;  C:\\Program Files\\Git\\cmd ;'), { SystemRoot: 'C:\\Windows' })).toEqual(['%SystemRoot%', 'C:\\Program Files\\Git\\cmd'])
  })

  it('reads nothing from an empty value or an answer without one', () => {
    expect(registryPathOf('\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ\r\n', {})).toEqual([])
    expect(registryPathOf('', {})).toEqual([])
  })
})

describe('addedPath', () => {
  it('keeps the current PATH in front and adds only the folders it lacks, each once', () => {
    const current = 'C:\\nvm\\node;C:\\Windows\\system32'
    expect(addedPath(current, ['c:\\windows\\System32\\', 'C:\\Program Files\\Git\\cmd', 'C:\\Program Files\\Git\\cmd\\', 'C:\\nvm\\node'], 'win32')).toBe(
      'C:\\nvm\\node;C:\\Windows\\system32;C:\\Program Files\\Git\\cmd',
    )
  })

  it('says null when the registry has nothing new', () => {
    expect(addedPath('C:\\Windows\\system32', ['C:\\WINDOWS\\system32'], 'win32')).toBeNull()
  })

  it('starts from nothing when the PATH is empty', () => {
    expect(addedPath('', ['C:\\Program Files\\Git\\cmd'], 'win32')).toBe('C:\\Program Files\\Git\\cmd')
  })
})

describe('refreshWindowsPath', () => {
  const queries = (machine: string | null, user: string | null) => async (key: string) => (key === MACHINE_ENVIRONMENT ? machine : key === USER_ENVIRONMENT ? user : null)

  it('adds the machine folders, then the user ones, to the PATH it was given, under the key it is spelled with', async () => {
    const env: NodeJS.ProcessEnv = { Path: 'C:\\Windows\\system32', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\john' }
    const query = queries(answer('REG_EXPAND_SZ', '%SystemRoot%\\system32;C:\\Program Files\\Git\\cmd'), answer('REG_EXPAND_SZ', '%USERPROFILE%\\bin'))
    expect(await refreshWindowsPath(env, 'win32', query)).toBe(true)
    expect(env).toEqual({ Path: 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd;C:\\Users\\john\\bin', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\john' })
  })

  it('changes nothing when the registry adds nothing or cannot be read', async () => {
    const env: NodeJS.ProcessEnv = { PATH: 'C:\\Windows\\system32' }
    expect(await refreshWindowsPath(env, 'win32', queries(answer('REG_SZ', 'C:\\Windows\\System32'), null))).toBe(false)
    expect(await refreshWindowsPath(env, 'win32', queries(null, null))).toBe(false)
    expect(env).toEqual({ PATH: 'C:\\Windows\\system32' })
  })

  it('reads no registry off Windows', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    const query = async () => {
      throw new Error('no registry here')
    }
    expect(await refreshWindowsPath(env, 'linux', query)).toBe(false)
    expect(env).toEqual({ PATH: '/usr/bin' })
  })
})
