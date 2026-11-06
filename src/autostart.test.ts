import { describe, expect, it, vi } from 'vitest'
import { autostartOf, hostDirOf, removeHostExe, runCommandOf } from './autostart.js'

const failure = (code: string) => Object.assign(new Error(`${code}, Permission denied`), { code })

const PACKAGE = {
  exe: 'C:\\Users\\jdoe\\AppData\\Local\\even-keel\\service\\EvenKeel.exe',
  root: 'C:\\Users\\jdoe\\AppData\\Roaming\\npm\\node_modules\\even-keel',
  node: 'C:\\Program Files\\nodejs\\node.exe',
  data: 'C:\\Users\\jdoe\\AppData\\Local\\even-keel',
}

describe('hostDirOf', () => {
  it('compiles the host into a checkout of its own and into the data folder of a package, which npm does not replace', () => {
    expect(hostDirOf('D:\\repos\\even-keel', 'git', 'D:\\repos\\even-keel')).toBe('D:\\repos\\even-keel\\service\\bin')
    expect(hostDirOf(PACKAGE.root, 'npm', PACKAGE.data)).toBe('C:\\Users\\jdoe\\AppData\\Local\\even-keel\\service')
  })
})

describe('runCommandOf', () => {
  it('starts the host in its tray mode with the root, node and a package data folder', () => {
    expect(runCommandOf(PACKAGE)).toBe(`"${PACKAGE.exe}" "${PACKAGE.root}" "${PACKAGE.node}" "${PACKAGE.data}" --tray`)
    expect(runCommandOf({ ...PACKAGE, data: null })).toBe(`"${PACKAGE.exe}" "${PACKAGE.root}" "${PACKAGE.node}" --tray`)
  })
})

describe('autostartOf', () => {
  const query = (value: string) => `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    EvenKeel    REG_SZ    ${value}\r\n\r\n`

  it('reads back the value runCommandOf wrote', () => {
    expect(autostartOf(query(runCommandOf(PACKAGE)))).toEqual(PACKAGE)
    expect(autostartOf(query(runCommandOf({ ...PACKAGE, data: null })))).toEqual({ ...PACKAGE, data: null })
  })

  it('finds none in a value it did not write or in no answer', () => {
    expect(autostartOf(query('"C:\\Tools\\Other.exe" --minimized'))).toBeNull()
    expect(autostartOf(query(`"${PACKAGE.exe}" "${PACKAGE.root}"`))).toBeNull()
    expect(autostartOf('ERROR: The system was unable to find the specified registry key or value.\r\n')).toBeNull()
    expect(autostartOf('')).toBeNull()
  })
})

describe('removeHostExe', () => {
  it('retries while the quitting host still holds its exe', () => {
    const remove = vi.fn()
      .mockImplementationOnce(() => { throw failure('EPERM') })
      .mockImplementationOnce(() => { throw failure('EBUSY') })
      .mockImplementationOnce(() => undefined)
    const wait = vi.fn()
    removeHostExe(PACKAGE.exe, remove, wait)
    expect(remove).toHaveBeenCalledTimes(3)
    expect(remove).toHaveBeenCalledWith(PACKAGE.exe)
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it('gives up after ten seconds of waiting with a message saying what to do', () => {
    const remove = vi.fn(() => { throw failure('EPERM') })
    const waits: number[] = []
    expect(() => removeHostExe(PACKAGE.exe, remove, (ms) => waits.push(ms))).toThrow(/still in use after 10 s \(EPERM\): quit Even Keel/)
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(10_000)
  })

  it('does not wait on any other error', () => {
    const wait = vi.fn()
    expect(() => removeHostExe(PACKAGE.exe, () => { throw failure('ENOTDIR') }, wait)).toThrow(/ENOTDIR/)
    expect(wait).not.toHaveBeenCalled()
  })
})
