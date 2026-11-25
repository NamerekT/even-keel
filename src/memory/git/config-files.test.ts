import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigFiles } from './config-files.js'

let root: string
let globalDir: string
let folder: string
let logs: string[]
let files: ConfigFiles

const live = (file: string) => join(globalDir, file)
const copied = (file: string) => join(folder, file)
const read = (path: string) => readFileSync(path, 'utf8')
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'even-keel-config-files-'))
  globalDir = join(root, '.claude')
  folder = join(root, '.claude-config')
  mkdirSync(globalDir)
  mkdirSync(join(folder, '.git'), { recursive: true })
  logs = []
  files = new ConfigFiles({ globalDir, folder, log: (line) => logs.push(line) })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('ConfigFiles (BTN-1690)', () => {
  it('takes CLAUDE.md and settings.json into the copy, settings.json without its env', () => {
    writeFileSync(live('CLAUDE.md'), '# Rules\n')
    writeFileSync(live('settings.json'), JSON.stringify({ model: 'opus', env: { SECRET_HOME: '/home/john' } }))
    files.takeIn()
    expect(read(copied('CLAUDE.md'))).toBe('# Rules\n')
    expect(read(copied('settings.json'))).toBe(json({ model: 'opus' }))
  })

  it("gives the network's version back with the machine's own env, and leaves a file it gave out alone", () => {
    writeFileSync(live('settings.json'), JSON.stringify({ model: 'opus', env: { HOME_ONLY: '1' } }))
    files.takeIn()
    writeFileSync(copied('settings.json'), json({ model: 'sonnet', env: { FROM_ELSEWHERE: '1' } }))
    writeFileSync(copied('CLAUDE.md'), '# Rules of the network\n')
    files.giveOut()
    expect(JSON.parse(read(live('settings.json')))).toEqual({ model: 'sonnet', env: { HOME_ONLY: '1' } })
    expect(read(live('CLAUDE.md'))).toBe('# Rules of the network\n')
    files.takeIn()
    expect(read(copied('settings.json'))).toBe(json({ model: 'sonnet', env: { FROM_ELSEWHERE: '1' } }))
  })

  it('takes nothing that did not change since the last exchange, so a sync brings the copy back out', () => {
    writeFileSync(live('CLAUDE.md'), '# Rules\n')
    files.takeIn()
    writeFileSync(copied('CLAUDE.md'), '# Rules, merged\n')
    files.takeIn()
    expect(read(copied('CLAUDE.md'))).toBe('# Rules, merged\n')
    files.giveOut()
    expect(read(live('CLAUDE.md'))).toBe('# Rules, merged\n')
  })

  it('does not overwrite a global file edited since the last exchange: the next takeIn carries it in', () => {
    writeFileSync(live('CLAUDE.md'), '# Rules\n')
    files.takeIn()
    writeFileSync(copied('CLAUDE.md'), '# Rules of the network\n')
    writeFileSync(live('CLAUDE.md'), '# Rules edited here\n')
    files.giveOut()
    expect(read(live('CLAUDE.md'))).toBe('# Rules edited here\n')
    files.takeIn()
    expect(read(copied('CLAUDE.md'))).toBe('# Rules edited here\n')
  })

  it('carries no deletion: a missing global file is laid anew, a missing copy deletes nothing', () => {
    writeFileSync(copied('CLAUDE.md'), '# Rules\n')
    files.giveOut()
    expect(read(live('CLAUDE.md'))).toBe('# Rules\n')
    rmSync(copied('CLAUDE.md'))
    files.giveOut()
    files.takeIn()
    expect(existsSync(live('CLAUDE.md'))).toBe(true)
  })

  it('skips a settings.json that is not JSON, told in the log once', () => {
    writeFileSync(live('settings.json'), '{ broken')
    files.takeIn()
    files.takeIn()
    expect(existsSync(copied('settings.json'))).toBe(false)
    expect(logs).toEqual([expect.stringContaining('is not a JSON object')])
  })
})
