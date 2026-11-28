import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../../git/run.js'
import { agentSkillsDir } from '../../account/agent-skills.js'
import { ConfigCopy } from './config-copy.js'
import { pendingConflicts } from './conflicts.js'
import { MEMORY_BRANCH } from './sync.js'

let root: string
let bare: string

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'even-keel-config-copy-'))
  bare = join(root, 'config.git')
  const made = await runGit(root, ['init', '-q', '--bare', '-b', MEMORY_BRANCH, bare])
  if (made.code !== 0) throw new Error(made.out)
})

afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

function machine(name: string) {
  const globalDir = join(root, name, '.claude')
  mkdirSync(globalDir, { recursive: true })
  const switched = { apart: false }
  const copy = new ConfigCopy({ globalDir, remote: bare, author: name, log: () => {}, schedule: () => () => {}, watch: () => () => {}, apart: () => switched.apart })
  return { globalDir, copy, agents: agentSkillsDir(globalDir), switched }
}

type Machine = ReturnType<typeof machine>
const live = (at: Machine, file: string) => readFileSync(join(at.globalDir, file), 'utf8')
const setLive = (at: Machine, file: string, text: string, ago = 0) => {
  const path = join(at.globalDir, file)
  writeFileSync(path, text)
  const time = new Date(Date.now() - ago)
  utimesSync(path, time, time)
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

describe('"Own configuration" of a machine (BTN-1745)', { timeout: 120_000 }, () => {
  /** `a` and `b` share one CLAUDE.md and settings.json, then `b` keeps its own. */
  async function joined(): Promise<[Machine, Machine]> {
    const a = machine('a')
    setLive(a, 'CLAUDE.md', '# Rules\n')
    setLive(a, 'settings.json', json({ model: 'opus' }))
    await a.copy.start()
    const b = machine('b')
    await b.copy.start()
    expect(live(b, 'CLAUDE.md')).toBe('# Rules\n')
    b.switched.apart = true
    await b.copy.syncNow()
    return [a, b]
  }

  it("keeps the machine's CLAUDE.md and settings.json out of the network both ways, while a skill still comes", async () => {
    const [a, b] = await joined()
    setLive(a, 'CLAUDE.md', '# Rules of the network\n')
    setLive(a, 'settings.json', json({ model: 'sonnet' }))
    mkdirSync(join(a.copy.folder, 'skills', 'review'), { recursive: true })
    writeFileSync(join(a.copy.folder, 'skills', 'review', 'SKILL.md'), '# Review\n')
    await a.copy.syncNow()
    await b.copy.syncNow()
    expect(live(b, 'CLAUDE.md')).toBe('# Rules\n')
    expect(JSON.parse(live(b, 'settings.json'))).toEqual({ model: 'opus' })
    expect(existsSync(join(b.globalDir, 'skills', 'review', 'SKILL.md'))).toBe(true)

    setLive(b, 'CLAUDE.md', '# Rules of the server\n')
    setLive(b, 'settings.json', json({ model: 'haiku', env: { HOME_ONLY: '1' } }))
    await b.copy.syncNow()
    await a.copy.syncNow()
    expect(live(a, 'CLAUDE.md')).toBe('# Rules of the network\n')
    expect(JSON.parse(live(a, 'settings.json'))).toEqual({ model: 'sonnet' })
    expect(live(b, 'CLAUDE.md')).toBe('# Rules of the server\n')
    expect(a.copy.conflicts()).toEqual([])
    a.copy.stop()
    b.copy.stop()
  })

  it('turned off, meets the network with files that differ as a conflict, never a silent overwrite', async () => {
    const [a, b] = await joined()
    setLive(a, 'settings.json', json({ model: 'sonnet' }), 60_000)
    await a.copy.syncNow()
    setLive(b, 'CLAUDE.md', '# Rules of the server\n')
    setLive(b, 'settings.json', json({ model: 'haiku' }))
    await b.copy.syncNow()
    b.switched.apart = false
    const outcome = await b.copy.syncNow()
    expect([...outcome.conflicts].sort()).toEqual(['CLAUDE.md', 'settings.json'])
    // The machine's own files are newer: they stay, the network's are the other versions.
    expect(live(b, 'CLAUDE.md')).toBe('# Rules of the server\n')
    expect(JSON.parse(live(b, 'settings.json'))).toEqual({ model: 'haiku' })
    await a.copy.syncNow()
    expect(a.copy.conflicts()).toMatchObject([{ file: 'settings.json', machine: 'b', kept: json({ model: 'haiku' }), other: json({ model: 'sonnet' }) }])
    expect(pendingConflicts(a.copy.folder).find((each) => each.file === 'CLAUDE.md')).toMatchObject({ otherText: '# Rules\n', by: 'b' })
    a.copy.stop()
    b.copy.stop()
  })

  it("turned off with an older own file, keeps the network's and puts the own one in the history", async () => {
    const [a, b] = await joined()
    setLive(b, 'CLAUDE.md', '# Rules of the server\n', 3_600_000)
    await b.copy.syncNow()
    setLive(a, 'CLAUDE.md', '# Rules of the network\n')
    await a.copy.syncNow()
    b.switched.apart = false
    expect((await b.copy.syncNow()).conflicts).toEqual(['CLAUDE.md'])
    expect(live(b, 'CLAUDE.md')).toBe('# Rules of the network\n')
    expect(pendingConflicts(b.copy.folder)).toMatchObject([{ file: 'CLAUDE.md', otherText: '# Rules of the server\n' }])
    a.copy.stop()
    b.copy.stop()
  })

  it('turned off with the same files, joins without a conflict and syncs as before', async () => {
    const [a, b] = await joined()
    b.switched.apart = false
    expect((await b.copy.syncNow()).conflicts).toEqual([])
    setLive(a, 'CLAUDE.md', '# Rules, later\n')
    await a.copy.syncNow()
    await b.copy.syncNow()
    expect(live(b, 'CLAUDE.md')).toBe('# Rules, later\n')
    a.copy.stop()
    b.copy.stop()
  })

  it('turned on, ends a conflict of its settings.json met on this machine', async () => {
    const [a, b] = await joined()
    b.switched.apart = false
    await b.copy.syncNow()
    setLive(a, 'settings.json', json({ model: 'sonnet' }))
    setLive(b, 'settings.json', json({ model: 'haiku' }))
    await a.copy.syncNow()
    await b.copy.syncNow()
    await a.copy.syncNow()
    expect(a.copy.conflicts()).toMatchObject([{ file: 'settings.json', machine: 'b' }])
    b.switched.apart = true
    await b.copy.syncNow()
    expect(b.copy.conflicts()).toEqual([])
    await a.copy.syncNow()
    expect(a.copy.conflicts()).toEqual([])
    a.copy.stop()
    b.copy.stop()
  })
})

describe('ConfigCopy links the skills for the other agents (BTN-1691)', { timeout: 120_000 }, () => {
  it("links a skill of the global folder at start, one synced from elsewhere after the sync, and drops one deleted", async () => {
    const a = machine('a')
    mkdirSync(join(a.globalDir, 'skills', 'review'), { recursive: true })
    writeFileSync(join(a.globalDir, 'skills', 'review', 'SKILL.md'), '# Review\n')
    await a.copy.start()
    expect(lstatSync(join(a.agents, 'review')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(a.agents, 'review', 'SKILL.md'))).toBe(true)

    const b = machine('b')
    await b.copy.start()
    expect(existsSync(join(b.agents, 'review', 'SKILL.md'))).toBe(true)

    rmSync(join(a.copy.folder, 'skills', 'review'), { recursive: true })
    await a.copy.syncNow()
    expect(existsSync(join(a.agents, 'review'))).toBe(false)
    await b.copy.syncNow()
    expect(() => lstatSync(join(b.agents, 'review'))).toThrow()
    a.copy.stop()
    b.copy.stop()
  })

  it('links a synced skill into ~/.claude/skills too, and a skill deleted there leaves every copy (BTN-1736)', async () => {
    const a = machine('a')
    mkdirSync(join(a.globalDir, 'skills', 'review'), { recursive: true })
    writeFileSync(join(a.globalDir, 'skills', 'review', 'SKILL.md'), '# Review\n')
    await a.copy.start()
    const b = machine('b')
    await b.copy.start()
    expect(existsSync(join(b.globalDir, 'skills', 'review', 'SKILL.md'))).toBe(true)

    rmSync(join(b.globalDir, 'skills', 'review'))
    await b.copy.syncNow()
    expect(existsSync(join(b.copy.folder, 'skills', 'review'))).toBe(false)
    expect(() => lstatSync(join(b.agents, 'review'))).toThrow()
    await a.copy.syncNow()
    expect(existsSync(join(a.copy.folder, 'skills', 'review'))).toBe(false)
    for (const dir of [join(a.globalDir, 'skills'), a.agents]) expect(() => lstatSync(join(dir, 'review'))).toThrow()
    a.copy.stop()
    b.copy.stop()
  })
})
