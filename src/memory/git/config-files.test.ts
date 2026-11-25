import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fileHash } from '../record.js'
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
    writeFileSync(copied('CLAUDE.md'), '# Rules edited in the copy\n')
    files.takeIn()
    expect(read(copied('CLAUDE.md'))).toBe('# Rules edited in the copy\n')
    expect(read(copied('settings.json'))).toBe(json({ model: 'sonnet' }))
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

  it('keeps hooks, statusLine and extraKnownMarketplaces on each machine, while a shared key travels (BTN-1707)', () => {
    const machine = (name: string, path: string) => {
      const home = join(root, name)
      mkdirSync(join(home, '.claude'), { recursive: true })
      mkdirSync(join(home, '.claude-config', '.git'), { recursive: true })
      const own = {
        hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${path}/rule-hook.mjs"` }] }] },
        statusLine: { type: 'command', command: `node "${path}/statusline.mjs"` },
        extraKnownMarketplaces: { 'even-keel': { source: { source: 'directory', path } } },
        env: { HOME_ONLY: name },
      }
      writeFileSync(join(home, '.claude', 'settings.json'), json({ permissions: { allow: ['Read'] }, ...own }))
      const sync = new ConfigFiles({ globalDir: join(home, '.claude'), folder: join(home, '.claude-config'), log: () => {} })
      return { home, own, sync, settings: () => JSON.parse(read(join(home, '.claude', 'settings.json'))) as unknown }
    }
    const pc = machine('pc', 'D:/Projects/even-keel/tally/bin')
    const server = machine('server', '/home/john/even-keel/tally/bin')
    const carry = (from: typeof pc, to: typeof pc) =>
      writeFileSync(join(to.home, '.claude-config', 'settings.json'), read(join(from.home, '.claude-config', 'settings.json')))

    pc.sync.takeIn()
    server.sync.takeIn()
    expect(read(join(pc.home, '.claude-config', 'settings.json'))).toBe(json({ permissions: { allow: ['Read'] } }))
    expect(read(join(server.home, '.claude-config', 'settings.json'))).toBe(read(join(pc.home, '.claude-config', 'settings.json')))

    writeFileSync(join(pc.home, '.claude', 'settings.json'), json({ permissions: { allow: ['Read', 'Edit'] }, ...pc.own }))
    pc.sync.takeIn()
    carry(pc, server)
    server.sync.giveOut()
    expect(server.settings()).toEqual({ permissions: { allow: ['Read', 'Edit'] }, ...server.own })
    expect(pc.settings()).toEqual({ permissions: { allow: ['Read', 'Edit'] }, ...pc.own })
  })

  it("drops machine-local keys from a copy an older build wrote, though the global file did not change (BTN-1707)", () => {
    const own = { statusLine: { type: 'command', command: 'node "/home/john/statusline.mjs"' } }
    writeFileSync(live('settings.json'), json({ model: 'opus', ...own }))
    files.takeIn()
    const stateFile = join(folder, '.git', 'even-keel-config-files.json')
    const old = json({ model: 'opus', statusLine: { type: 'command', command: 'node "D:/statusline.mjs"' } })
    writeFileSync(copied('settings.json'), old)
    const state = JSON.parse(read(stateFile)) as Record<string, { live: string; copy: string }>
    writeFileSync(stateFile, JSON.stringify({ 'settings.json': { ...state['settings.json'], copy: fileHash(old) } }))
    files.takeIn()
    expect(read(copied('settings.json'))).toBe(json({ model: 'opus' }))
    files.giveOut()
    expect(JSON.parse(read(live('settings.json')))).toEqual({ model: 'opus', ...own })
  })

  it('skips a settings.json that is not JSON, told in the log once', () => {
    writeFileSync(live('settings.json'), '{ broken')
    files.takeIn()
    files.takeIn()
    expect(existsSync(copied('settings.json'))).toBe(false)
    expect(logs).toEqual([expect.stringContaining('is not a JSON object')])
  })
})
