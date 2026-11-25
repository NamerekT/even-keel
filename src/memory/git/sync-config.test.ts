import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../../git/run.js'
import { pendingConflicts } from './conflicts.js'
import { MEMORY_BRANCH, MemorySync } from './sync.js'

let root: string
let bare: string
let logs: string[]

interface Copy {
  folder: string
  sync: MemorySync
}

function copy(name: string): Copy {
  const folder = join(root, name)
  const sync = new MemorySync({
    kind: 'config',
    folder,
    remote: bare,
    author: name,
    log: (line) => logs.push(line),
    schedule: () => () => {},
    watch: () => () => {},
  })
  return { folder, sync }
}

const write = (at: Copy, file: string, text: string) => {
  mkdirSync(dirname(join(at.folder, file)), { recursive: true })
  writeFileSync(join(at.folder, file), text)
}
const read = (at: Copy, file: string) => readFileSync(join(at.folder, file), 'utf8')
const SKILL = ['---', 'name: review', '---', '', 'One.', '', 'Two.', '', 'Three.', ''].join('\n')
const SETTINGS = (model: string, theme: string) => `{\n  "model": "${model}",\n  "x": 1,\n  "y": 2,\n  "z": 3,\n  "theme": "${theme}"\n}\n`

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'even-keel-config-sync-'))
  bare = join(root, 'config.git')
  logs = []
  const made = await runGit(root, ['init', '-q', '--bare', '-b', MEMORY_BRANCH, bare])
  if (made.code !== 0) throw new Error(made.out)
})

afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

describe('MemorySync of the global configuration (BTN-1690)', { timeout: 120_000 }, () => {
  it('syncs files of subfolders, merges a text edited on other lines by two machines, and keeps no MEMORY.md', async () => {
    const a = copy('a')
    write(a, 'skills/review/SKILL.md', SKILL)
    await a.sync.start()
    const b = copy('b')
    await b.sync.start()
    expect(read(b, 'skills/review/SKILL.md')).toBe(SKILL)
    write(a, 'skills/review/SKILL.md', SKILL.replace('One.', 'One of a.'))
    write(b, 'skills/review/SKILL.md', SKILL.replace('Three.', 'Three of b.'))
    await a.sync.sync()
    expect(await b.sync.sync()).toMatchObject({ conflicts: [], reached: true })
    expect(read(b, 'skills/review/SKILL.md')).toBe(SKILL.replace('One.', 'One of a.').replace('Three.', 'Three of b.'))
    expect(read(b, '.gitattributes')).toBe('hooks/** -merge\nsettings.json -merge\n')
    expect((await runGit(b.folder, ['ls-files'])).out.split('\n').sort()).toEqual(['.gitattributes', 'skills/review/SKILL.md'])
    expect(logs.every((line) => line.startsWith('config: '))).toBe(true)
  })

  it('never merges settings.json or a hook: a change on both sides keeps the newer and leaves a conflict for a person', async () => {
    const a = copy('a')
    write(a, 'settings.json', SETTINGS('opus', 'dark'))
    write(a, 'hooks/guard.mjs', '// guard\n')
    await a.sync.start()
    const b = copy('b')
    await b.sync.start()
    write(a, 'settings.json', SETTINGS('sonnet', 'dark'))
    write(a, 'hooks/guard.mjs', '// guard of a\n')
    write(b, 'settings.json', SETTINGS('opus', 'light'))
    write(b, 'hooks/guard.mjs', '// guard of b\n')
    await a.sync.sync()
    const outcome = await b.sync.sync()
    expect(outcome).toMatchObject({ reached: true })
    expect([...outcome.conflicts].sort()).toEqual(['hooks/guard.mjs', 'settings.json'])
    expect(read(b, 'settings.json')).toBe(SETTINGS('opus', 'light'))
    const conflicts = pendingConflicts(b.folder)
    expect(conflicts.map((conflict) => [conflict.file, conflict.human])).toEqual(
      expect.arrayContaining([
        ['settings.json', true],
        ['hooks/guard.mjs', true],
      ]),
    )
    expect(conflicts.find((conflict) => conflict.file === 'settings.json')!.otherText).toBe(SETTINGS('sonnet', 'dark'))
    expect(logs.some((line) => line.includes('settings.json') && line.includes('a person settles'))).toBe(true)
    expect((await runGit(b.folder, ['log', '-1', '--format=%B'])).out).toContain('Config-Conflict: ')
  })

  it("takes a CLAUDE.md both machines had before they met as a conflict for sessions, never replacing one silently", async () => {
    const a = copy('a')
    write(a, 'CLAUDE.md', '# Rules of a\n')
    await a.sync.start()
    const b = copy('b')
    write(b, 'CLAUDE.md', '# Rules of b\n')
    expect(await b.sync.start()).toMatchObject({ conflicts: ['CLAUDE.md'], reached: true })
    const [conflict] = pendingConflicts(b.folder)
    expect(conflict).toMatchObject({ file: 'CLAUDE.md', otherText: '# Rules of a\n' })
    expect(conflict!.human).toBeUndefined()
    expect(conflict!.note).toContain('global configuration')
  })

  describe("a person's choice of a version (BTN-1692)", () => {
    /** `a` pushes a hook first, `b` meets it with its own: the conflict is met on `b`, `b`'s version newer. */
    async function conflicted(): Promise<[Copy, Copy]> {
      const a = copy('a')
      write(a, 'hooks/guard.mjs', '// guard\n')
      await a.sync.start()
      const b = copy('b')
      await b.sync.start()
      write(a, 'hooks/guard.mjs', '// guard of a\n')
      write(b, 'hooks/guard.mjs', '// guard of b\n')
      await a.sync.sync()
      await b.sync.sync()
      await a.sync.sync()
      return [a, b]
    }

    it('names the machine the conflict was met on', async () => {
      const [a, b] = await conflicted()
      expect(pendingConflicts(a.folder)).toMatchObject([{ file: 'hooks/guard.mjs', by: 'b', human: true }])
      expect(pendingConflicts(b.folder)).toMatchObject([{ file: 'hooks/guard.mjs', by: 'b' }])
    })

    it('keeps this version by a commit that closes the conflict on every copy, the file unchanged', async () => {
      const [a, b] = await conflicted()
      const [conflict] = pendingConflicts(a.folder)
      expect(await a.sync.settle('hooks/guard.mjs', conflict!.hash, 'kept')).toBe(true)
      expect(read(a, 'hooks/guard.mjs')).toBe('// guard of b\n')
      expect(pendingConflicts(a.folder)).toEqual([])
      expect((await runGit(a.folder, ['log', '-1', '--format=%B'])).out).toContain('Config-Settled: hooks/guard.mjs')
      await b.sync.sync()
      expect(pendingConflicts(b.folder)).toEqual([])
    })

    it('takes the other version into the file on every copy', async () => {
      const [a, b] = await conflicted()
      const [conflict] = pendingConflicts(b.folder)
      expect(await b.sync.settle('hooks/guard.mjs', conflict!.hash, 'other')).toBe(true)
      expect(read(b, 'hooks/guard.mjs')).toBe('// guard of a\n')
      expect(pendingConflicts(b.folder)).toEqual([])
      await a.sync.sync()
      expect(read(a, 'hooks/guard.mjs')).toBe('// guard of a\n')
      expect(pendingConflicts(a.folder)).toEqual([])
    })

    it('refuses a choice the conflict has moved past: settled already, or the file saved since', async () => {
      const [a] = await conflicted()
      const [conflict] = pendingConflicts(a.folder)
      expect(await a.sync.settle('hooks/guard.mjs', 'stale', 'other')).toBe(false)
      expect(await a.sync.settle('skills/none/SKILL.md', conflict!.hash, 'other')).toBe(false)
      expect(await a.sync.settle('hooks/guard.mjs', conflict!.hash, 'kept')).toBe(true)
      expect(await a.sync.settle('hooks/guard.mjs', conflict!.hash, 'other')).toBe(false)
      expect(read(a, 'hooks/guard.mjs')).toBe('// guard of b\n')
    })

    it('opens again at a later conflict in the same file', async () => {
      const [a, b] = await conflicted()
      await a.sync.settle('hooks/guard.mjs', pendingConflicts(a.folder)[0]!.hash, 'kept')
      await b.sync.sync()
      write(a, 'hooks/guard.mjs', '// guard of a, again\n')
      write(b, 'hooks/guard.mjs', '// guard of b, again\n')
      await b.sync.sync()
      await a.sync.sync()
      expect(pendingConflicts(a.folder)).toMatchObject([{ file: 'hooks/guard.mjs', by: 'a' }])
    })
  })
})
