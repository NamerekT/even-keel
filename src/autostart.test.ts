import { describe, expect, it } from 'vitest'
import { autostartOf, hostDirOf, runCommandOf } from './autostart.js'

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
