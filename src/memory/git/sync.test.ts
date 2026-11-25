import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runGit } from '../../git/run.js'
import { memoryFile } from '../record.js'
import { CONFLICTS_FILE, pendingConflicts } from './conflicts.js'
import { MEMORY_BRANCH, MemorySync, SETTLE_MS, RETRY_MS } from './sync.js'

let root: string
let bare: string
let logs: string[]

const identity = {
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'user.name',
  GIT_CONFIG_VALUE_0: 'John Doe',
  GIT_CONFIG_KEY_1: 'core.hooksPath',
  GIT_CONFIG_VALUE_1: 'no-hooks',
}

const git = async (cwd: string, ...args: string[]) => {
  const result = await runGit(cwd, args, { ...identity, GIT_AUTHOR_EMAIL: 'john.doe@example.com', GIT_COMMITTER_EMAIL: 'john.doe@example.com' })
  if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.out}`)
  return result.out
}

interface Copy {
  folder: string
  sync: MemorySync
  timers: { run: () => void; ms: number }[]
}

function copy(name: string, remote = bare): Copy {
  const folder = join(root, name)
  const timers: Copy['timers'] = []
  const sync = new MemorySync({
    folder,
    remote,
    author: name,
    log: (line) => logs.push(line),
    schedule: (run, ms) => {
      const drop = () => timers.includes(timer) && timers.splice(timers.indexOf(timer), 1)
      const timer = { run: () => (drop(), run()), ms }
      timers.push(timer)
      return () => void drop()
    },
    watch: () => () => {},
  })
  return { folder, sync, timers }
}

const record = (name: string, description: string, body = 'Body.') => memoryFile({ name, description, type: 'project', body })
/** A record as the CLI writes it, with the service fields it adds itself. */
const cli = (body: string, modified: string, session = 'b1e2d3c4') =>
  `---\nname: tone\ndescription: Short answers\nmetadata:\n  node_type: memory\n  type: feedback\n  originSessionId: ${session}\n  modified: ${modified}\n---\n\n${body}\n`
const write = (at: Copy, file: string, text: string) => writeFileSync(join(at.folder, file), text)
const read = (at: Copy, file: string) => readFileSync(join(at.folder, file), 'utf8')
const files = (at: Copy) => readdirSync(at.folder).filter((name) => name !== '.git').sort()
const inBare = async () => (await git(bare, 'ls-tree', '--name-only', MEMORY_BRANCH)).split('\n').sort()

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'even-keel-memory-sync-'))
  bare = join(root, 'project.git')
  logs = []
  await git(root, 'init', '-q', '--bare', '-b', MEMORY_BRANCH, bare)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('MemorySync', { timeout: 120_000 }, () => {
  it('starts a missing folder, pushes its first commit and gives a second copy the same files', async () => {
    const a = copy('a')
    expect((await a.sync.start()).reached).toBe(true)
    expect((await runGit(bare, ['rev-parse', '--verify', '-q', MEMORY_BRANCH])).code).not.toBe(0)
    write(a, 'tone.md', record('tone', 'Short answers'))
    expect(await a.sync.sync()).toMatchObject({ committed: ['tone.md'], reached: true })
    expect(await inBare()).toEqual(['.gitattributes', 'MEMORY.md', 'tone.md'])
    expect(read(a, 'MEMORY.md')).toBe('- [tone](tone.md) — Short answers\n')

    const b = copy('b')
    await b.sync.start()
    expect(files(b)).toEqual(['.gitattributes', 'MEMORY.md', 'tone.md'])
    expect(read(b, '.gitattributes')).toBe('MEMORY.md merge=union\n')
  })

  it('leaves an empty repository to a copy with history, which pushes it as it is (BTN-1674)', async () => {
    const a = copy('a')
    await a.sync.start()
    write(a, 'tone.md', record('tone', 'Short answers'))
    await a.sync.sync()
    write(a, 'style.md', record('style', 'Plain words'))
    await a.sync.sync()
    const history = await git(a.folder, 'log', '--format=%H %cn', MEMORY_BRANCH)
    rmSync(bare, { recursive: true, force: true })
    await git(root, 'init', '-q', '--bare', '-b', MEMORY_BRANCH, bare)

    const hub = copy('hub')
    expect(await hub.sync.start()).toMatchObject({ committed: [], reached: true })
    expect((await runGit(bare, ['rev-parse', '--verify', '-q', MEMORY_BRANCH])).code).not.toBe(0)
    expect((await a.sync.sync()).reached).toBe(true)
    expect(await git(bare, 'log', '--format=%H %cn', MEMORY_BRANCH)).toBe(history)
    expect(await git(a.folder, 'log', '--format=%H %cn', MEMORY_BRANCH)).toBe(history)
    await hub.sync.sync()
    expect(files(hub)).toEqual(['.gitattributes', 'MEMORY.md', 'style.md', 'tone.md'])
    expect(await git(hub.folder, 'log', '--format=%H %cn', MEMORY_BRANCH)).toBe(history)
  })

  it('merges edits of two copies, MEMORY.md by union, and tidies its lines', async () => {
    const a = copy('a')
    const b = copy('b')
    await a.sync.start()
    await b.sync.start()
    write(a, 'one.md', record('one', 'From a'))
    write(a, 'MEMORY.md', '# Memory\n\n- [one](one.md) — From a\n')
    write(b, 'two.md', record('two', 'From b'))
    write(b, 'MEMORY.md', '# Memory\n\n- [two](two.md) — From b\n')
    expect((await a.sync.sync()).reached).toBe(true)
    expect(await b.sync.sync()).toMatchObject({ conflicts: [], reached: true })
    expect(read(b, 'MEMORY.md')).toBe('# Memory\n\n- [one](one.md) — From a\n- [two](two.md) — From b\n')
    await a.sync.sync()
    expect(files(a)).toEqual(['.gitattributes', 'MEMORY.md', 'one.md', 'two.md'])
    expect(read(a, 'MEMORY.md')).toBe(read(b, 'MEMORY.md'))
  })

  it('keeps the newer version of a record changed on the same lines on both sides, the other for sessions to merge', async () => {
    const a = copy('a')
    const b = copy('b')
    await a.sync.start()
    write(a, 'tone.md', cli('Base.', '2026-11-24T09:00:00.000Z'))
    await a.sync.sync()
    await b.sync.start()
    write(a, 'tone.md', cli('Version of a.', '2026-11-24T10:00:00.000Z'))
    write(b, 'tone.md', cli('Version of b.', '2026-11-24T11:00:00.000Z'))
    await a.sync.sync()
    expect(await b.sync.sync()).toMatchObject({ conflicts: ['tone.md'], reached: true })
    expect(existsSync(join(b.folder, '.git', 'rebase-merge'))).toBe(false)
    expect(files(b)).toEqual(['.gitattributes', 'MEMORY.md', 'tone.md'])
    expect(read(b, 'tone.md')).toBe(cli('Version of b.', '2026-11-24T11:00:00.000Z'))
    const [conflict] = pendingConflicts(b.folder)
    expect(conflict).toMatchObject({ file: 'tone.md', otherText: cli('Version of a.', '2026-11-24T10:00:00.000Z') })
    expect(conflict!.note).toContain('Version of a.')
    expect(await git(b.folder, 'show', `${conflict!.other}:tone.md`)).toContain('Version of a.')

    await a.sync.sync()
    expect(read(a, 'tone.md')).toBe(read(b, 'tone.md'))
    expect(pendingConflicts(a.folder)).toMatchObject([{ file: 'tone.md', otherText: conflict!.otherText }])

    write(a, 'tone.md', cli('Version of a.\n\nVersion of b.', '2026-11-24T12:00:00.000Z'))
    expect(pendingConflicts(a.folder)).toEqual([])
    await a.sync.sync()
    expect(existsSync(join(a.folder, CONFLICTS_FILE))).toBe(false)
    expect(existsSync(join(b.folder, CONFLICTS_FILE))).toBe(true)
    await b.sync.sync()
    expect(existsSync(join(b.folder, CONFLICTS_FILE))).toBe(false)
  })

  it('keeps the remote version when it is newer and its own in the history for the merge', async () => {
    const a = copy('a')
    const b = copy('b')
    await a.sync.start()
    write(a, 'tone.md', cli('Base.', '2026-11-24T09:00:00.000Z'))
    await a.sync.sync()
    await b.sync.start()
    write(a, 'tone.md', cli('Version of a.', '2026-11-24T11:00:00.000Z'))
    write(b, 'tone.md', cli('Version of b.', '2026-11-24T10:00:00.000Z'))
    await a.sync.sync()
    expect(await b.sync.sync()).toMatchObject({ conflicts: ['tone.md'], reached: true })
    expect(read(b, 'tone.md')).toBe(cli('Version of a.', '2026-11-24T11:00:00.000Z'))
    expect(pendingConflicts(b.folder)).toMatchObject([{ file: 'tone.md', otherText: cli('Version of b.', '2026-11-24T10:00:00.000Z') }])
  })

  it('merges a record whose copies differ in the service fields and in different lines', async () => {
    const a = copy('a')
    const b = copy('b')
    await a.sync.start()
    write(a, 'tone.md', cli('First.\n\nSecond.\n\nThird.', '2026-11-24T09:00:00.000Z', 'base'))
    await a.sync.sync()
    await b.sync.start()
    write(a, 'tone.md', cli('First of a.\n\nSecond.\n\nThird.', '2026-11-24T10:00:00.000Z', 'aaa'))
    write(b, 'tone.md', cli('First.\n\nSecond.\n\nThird.\n\nFourth of b.', '2026-11-24T11:00:00.000Z', 'bbb'))
    await a.sync.sync()
    expect(await b.sync.sync()).toMatchObject({ conflicts: [], reached: true })
    expect(read(b, 'tone.md')).toBe(cli('First of a.\n\nSecond.\n\nThird.\n\nFourth of b.', '2026-11-24T11:00:00.000Z', 'bbb'))
    expect(existsSync(join(b.folder, CONFLICTS_FILE))).toBe(false)
    await a.sync.sync()
    expect(read(a, 'tone.md')).toBe(read(b, 'tone.md'))
  })

  it('meets a copy of its own history without a conflict: equal records are one, different ones keep the newer', async () => {
    const a = copy('a')
    mkdirSync(a.folder)
    write(a, 'tone.md', cli('Same.', '2026-11-24T18:31:00.000Z', 'aaa'))
    write(a, 'pace.md', cli('Old pace.', '2026-11-24T18:31:00.000Z'))
    write(a, 'tool.md', cli('Newer tool.', '2026-11-24T21:00:00.000Z'))
    await a.sync.start()
    const b = copy('b')
    mkdirSync(b.folder)
    write(b, 'tone.md', cli('Same.', '2026-11-24T20:46:00.000Z', 'bbb'))
    write(b, 'pace.md', cli('New pace.', '2026-11-24T20:46:00.000Z'))
    write(b, 'tool.md', cli('Older tool.', '2026-11-24T20:46:00.000Z'))
    expect(await b.sync.start()).toMatchObject({ conflicts: [], reached: true })
    expect(files(b)).toEqual(['.gitattributes', 'MEMORY.md', 'pace.md', 'tone.md', 'tool.md'])
    expect(read(b, 'tone.md')).toBe(cli('Same.', '2026-11-24T20:46:00.000Z', 'bbb'))
    expect(read(b, 'pace.md')).toBe(cli('New pace.', '2026-11-24T20:46:00.000Z'))
    expect(read(b, 'tool.md')).toBe(cli('Newer tool.', '2026-11-24T21:00:00.000Z'))
    expect(await git(b.folder, 'log', '-p', '--format=', '--', 'tool.md')).toContain('Older tool.')
    expect(existsSync(join(b.folder, CONFLICTS_FILE))).toBe(false)
    await a.sync.sync()
    expect(read(a, 'pace.md')).toBe(read(b, 'pace.md'))
  })

  it('keeps a changed record over a deletion on the other side', async () => {
    const a = copy('a')
    const b = copy('b')
    await a.sync.start()
    write(a, 'tone.md', record('tone', 'Short answers'))
    await a.sync.sync()
    await b.sync.start()
    unlinkSync(join(a.folder, 'tone.md'))
    write(b, 'tone.md', record('tone', 'Short answers', 'Changed.'))
    await a.sync.sync()
    expect(await inBare()).not.toContain('tone.md')
    expect((await b.sync.sync()).reached).toBe(true)
    expect(await inBare()).toContain('tone.md')
    expect(read(b, 'MEMORY.md')).toContain('(tone.md)')
  })

  it('without the remote keeps the commits and pushes them once it is back', async () => {
    const a = copy('a')
    await a.sync.start()
    const away = join(root, 'away.git')
    renameSync(bare, away)
    write(a, 'one.md', record('one', 'Offline'))
    const offline = await a.sync.sync()
    expect(offline).toMatchObject({ committed: ['one.md'], reached: false })
    expect(logs.some((line) => line.includes('cannot reach its repository'))).toBe(true)
    expect(a.timers.map((timer) => timer.ms)).toEqual([RETRY_MS])
    write(a, 'two.md', record('two', 'Offline too'))
    await a.sync.sync()
    renameSync(away, bare)
    a.timers[0]!.run()
    await a.sync.sync()
    expect(await inBare()).toEqual(['.gitattributes', 'MEMORY.md', 'one.md', 'two.md'])
    expect(a.timers).toEqual([])
  })

  it('commits at start what was edited while it was not running', async () => {
    const a = copy('a')
    await a.sync.start()
    a.sync.stop()
    write(a, 'hand.md', record('hand', 'Written by hand'))
    const again = copy('a')
    expect(await again.sync.start()).toMatchObject({ committed: ['hand.md'], reached: true })
    expect(await inBare()).toContain('hand.md')
  })

  it('takes the repository into an empty folder and into a folder of old files, deleting nothing', async () => {
    const a = copy('a')
    await a.sync.start()
    write(a, 'one.md', record('one', 'First'))
    write(a, 'two.md', record('two', 'Second'))
    await a.sync.sync()

    const empty = copy('empty')
    mkdirSync(empty.folder)
    await empty.sync.start()
    expect(files(empty)).toEqual(['.gitattributes', 'MEMORY.md', 'one.md', 'two.md'])
    expect(await inBare()).toEqual(['.gitattributes', 'MEMORY.md', 'one.md', 'two.md'])

    const old = copy('old')
    mkdirSync(old.folder)
    write(old, 'three.md', record('three', 'Third'))
    write(old, 'MEMORY.md', '- [three](three.md) — Third\n')
    expect((await old.sync.start()).reached).toBe(true)
    expect(await inBare()).toEqual(['.gitattributes', 'MEMORY.md', 'one.md', 'three.md', 'two.md'])
    expect(read(old, 'MEMORY.md').split('\n').filter(Boolean).sort()).toEqual([
      '- [one](one.md) — First',
      '- [three](three.md) — Third',
      '- [two](two.md) — Second',
    ])
  })

  it('finishes a rebase left stopped in the folder by aborting it first', async () => {
    const a = copy('a')
    const b = copy('b')
    await a.sync.start()
    write(a, 'tone.md', record('tone', 'Short'))
    await a.sync.sync()
    await b.sync.start()
    write(a, 'tone.md', record('tone', 'Short', 'From a.'))
    await a.sync.sync()
    write(b, 'tone.md', record('tone', 'Short', 'From b.'))
    await git(b.folder, 'commit', '-q', '-am', 'by hand')
    await git(b.folder, 'fetch', '-q', 'origin')
    await expect(git(b.folder, 'rebase', `origin/${MEMORY_BRANCH}`)).rejects.toThrow()
    expect(existsSync(join(b.folder, '.git', 'rebase-merge'))).toBe(true)
    expect(await b.sync.sync()).toMatchObject({ conflicts: ['tone.md'], reached: true })
    expect(logs.some((line) => line.includes('a rebase was left unfinished'))).toBe(true)
  })

  it('keeps a file that holds a key out of the commit and its line out of the index', async () => {
    const a = copy('a')
    await a.sync.start()
    write(a, 'keys.md', record('keys', 'Bench keys', `token: ghp_${'a1B2c3D4e5'.repeat(4)}`))
    write(a, 'tone.md', record('tone', 'Short'))
    expect(await a.sync.sync()).toMatchObject({ committed: ['tone.md'], withheld: ['keys.md'], reached: true })
    expect(await inBare()).toEqual(['.gitattributes', 'MEMORY.md', 'tone.md'])
    expect(read(a, 'MEMORY.md')).toBe('- [tone](tone.md) — Short\n')
    expect(logs.filter((line) => line.includes('keys.md is not committed'))).toEqual([expect.stringContaining('GitHub token on line 8')])
    await a.sync.sync()
    expect(logs.filter((line) => line.includes('keys.md is not committed'))).toHaveLength(1)
  })

  it('syncs SETTLE_MS after the last edit', async () => {
    const a = copy('a')
    await a.sync.start()
    write(a, 'one.md', record('one', 'Later'))
    a.sync.touched()
    a.sync.touched()
    expect(a.timers.map((timer) => timer.ms)).toEqual([SETTLE_MS])
    a.timers[0]!.run()
    await a.sync.sync()
    expect(await inBare()).toContain('one.md')
  })
})
