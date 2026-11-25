import type { PGlite } from '@electric-sql/pglite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runGit } from '../../git/run.js'
import { openDatabase } from '../../storage/database.js'
import { memoryFile } from '../record.js'
import { MemoryHub, memoryDirOf } from './hub.js'
import { MEMORY_BRANCH } from './sync.js'

const ONE = '11111111-1111-4111-8111-111111111111'
const TWO = '22222222-2222-4222-8222-222222222222'

let db: PGlite
let root: string
let dir: string
let logs: string[]
let folders: Record<string, string[]>
let hub: MemoryHub

const inRepository = async (project: string) => {
  const listed = await runGit(join(dir, `${project}.git`), ['ls-tree', '--name-only', MEMORY_BRANCH])
  return listed.code === 0 ? listed.out.split('\n').filter(Boolean).sort() : []
}

function makeHub(): MemoryHub {
  return new MemoryHub({
    db,
    dir,
    folders: () => folders,
    author: 'hub',
    log: (line) => logs.push(line),
    schedule: () => () => {},
    watch: () => () => {},
  })
}

describe('MemoryHub (BTN-1646)', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    db = await openDatabase(undefined)
  })
  afterAll(() => db.close())
  beforeEach(async () => {
    await db.exec(`delete from memory_records; delete from service_state where name = 'memory.transferred'`)
    root = mkdtempSync(join(tmpdir(), 'ek-memory-hub-'))
    dir = memoryDirOf(join(root, 'state'))
    logs = []
    folders = { [ONE]: [join(root, 'one')] }
    hub = makeHub()
  })
  afterEach(() => {
    hub.stop()
    // A git child of a sync stopped mid-run may still hold the folder on Windows for a moment.
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  })

  it("makes the project's repository and puts its records and hand files into it with the first sync", async () => {
    mkdirSync(join(root, 'one'))
    writeFileSync(join(root, 'one', 'hand.md'), memoryFile({ name: 'hand', description: 'by hand', type: 'user', body: 'x' }))
    await db.query(`insert into memory_records (project_id, name, description, type, body, version, at) values ($1, 'tone', 'short answers', 'feedback', 'Be short.', 4, 'now')`, [ONE])
    await hub.apply()
    await hub.syncAll()
    expect(existsSync(join(dir, `${ONE}.git`, 'HEAD'))).toBe(true)
    expect(existsSync(join(dir, `${ONE}.git.new`))).toBe(false)
    expect(await inRepository(ONE)).toEqual(['.gitattributes', 'MEMORY.md', 'hand.md', 'tone.md'])
    expect((await runGit(join(dir, `${ONE}.git`), ['rev-list', '--count', MEMORY_BRANCH])).out.trim()).toBe('1')
    expect(await hub.index(ONE)).toEqual(['- hand — by hand', '- tone — short answers'])
  })

  it('does not transfer again after a restart, and pushes a working copy into a repository lost on a move', async () => {
    await db.query(`insert into memory_records (project_id, name, description, type, body, version, at) values ($1, 'tone', 'short answers', 'feedback', 'Be short.', 1, 'now')`, [ONE])
    await hub.apply()
    await hub.syncAll()
    hub.stop()
    rmSync(join(root, 'one', 'tone.md'))
    rmSync(dir, { recursive: true, force: true })
    hub = makeHub()
    await hub.apply()
    await hub.syncAll()
    expect(await inRepository(ONE)).toEqual(['.gitattributes', 'MEMORY.md'])
    expect(existsSync(join(root, 'one', 'tone.md'))).toBe(false)
  })

  it('writes through the memory tools between syncs and commits a write at once, with no settle wait (BTN-1647)', async () => {
    await hub.apply()
    await hub.within(ONE, (folder) => writeFileSync(join(folder!, 'tone.md'), memoryFile({ name: 'tone', description: 'short', type: 'user', body: 'x' })), true)
    await vi.waitFor(async () => expect(await inRepository(ONE)).toContain('tone.md'), { timeout: 30_000, interval: 100 })
    expect(await hub.within(TWO, (folder) => folder)).toBeNull()
  })

  it("follows every push into a project's repository with one into the memory mirror (BTN-1649)", async () => {
    const mirror = join(root, 'mirror.git')
    await runGit(root, ['init', '--bare', '-q', mirror])
    hub.stop()
    hub = new MemoryHub({ db, dir, folders: () => folders, author: 'hub', log: (line) => logs.push(line), mirror: () => mirror, schedule: () => () => {}, watch: () => () => {} })
    await hub.apply()
    await hub.within(ONE, (folder) => writeFileSync(join(folder!, 'tone.md'), memoryFile({ name: 'tone', description: 'short', type: 'user', body: 'x' })), true)
    const head = async () => (await runGit(join(dir, `${ONE}.git`), ['rev-parse', MEMORY_BRANCH])).out
    const mirrored = async () => (await runGit(root, ['ls-remote', mirror, `refs/heads/${ONE}`])).out.split('\t')[0]
    await vi.waitFor(async () => expect(await inRepository(ONE)).toContain('tone.md'), { timeout: 30_000, interval: 100 })
    await vi.waitFor(async () => expect(await mirrored()).toBe(await head()), { timeout: 30_000, interval: 100 })
    expect(hub.mirrorView()).toEqual({ code: 'memory.mirrorPrivate', params: { address: mirror } })
  })

  it("makes a lost repository from the mirror's branch of the project, its history as it was (BTN-1674)", async () => {
    const mirror = join(root, 'mirror.git')
    await runGit(root, ['init', '--bare', '-q', mirror])
    const withMirror = () => new MemoryHub({ db, dir, folders: () => folders, author: 'hub', log: (line) => logs.push(line), mirror: () => mirror, schedule: () => () => {}, watch: () => () => {} })
    hub.stop()
    hub = withMirror()
    await hub.apply()
    await hub.within(ONE, (folder) => writeFileSync(join(folder!, 'tone.md'), memoryFile({ name: 'tone', description: 'short', type: 'user', body: 'x' })), true)
    const mirrored = async () => (await runGit(root, ['ls-remote', mirror, `refs/heads/${ONE}`])).out.split('\t')[0]
    await vi.waitFor(async () => expect(await mirrored()).toMatch(/^[0-9a-f]{40}$/), { timeout: 30_000, interval: 100 })
    const history = (await runGit(join(dir, `${ONE}.git`), ['log', '--format=%H', MEMORY_BRANCH])).out
    hub.stop()
    rmSync(join(root, 'one'), { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })

    hub = withMirror()
    await hub.apply()
    await hub.syncAll()
    expect((await runGit(join(dir, `${ONE}.git`), ['log', '--format=%H', MEMORY_BRANCH])).out).toBe(history)
    expect(existsSync(join(root, 'one', 'tone.md'))).toBe(true)
    expect(logs).toContain(`memory: ${ONE} has a new repository ${join(dir, `${ONE}.git`)}, its history taken from the mirror`)
  })

  it('gives a folder two projects name to the first, telling it once, and stops the copy of a project gone', async () => {
    mkdirSync(join(root, 'one'))
    symlinkSync(join(root, 'one'), join(root, 'alias'), 'junction')
    folders = { [ONE]: [join(root, 'one')], [TWO]: [join(root, 'alias')] }
    await hub.apply()
    await hub.apply()
    await hub.syncAll()
    expect(logs.filter((line) => line.includes('gets no working copy'))).toHaveLength(1)
    expect(existsSync(join(dir, `${TWO}.git`))).toBe(false)
    expect(await hub.within(TWO, (folder) => folder)).toBe(join(root, 'alias'))

    folders = {}
    await hub.apply()
    writeFileSync(join(root, 'one', 'late.md'), memoryFile({ name: 'late', description: 'late', type: 'user', body: 'x' }))
    await hub.syncAll()
    expect(await inRepository(ONE)).not.toContain('late.md')
    expect(existsSync(join(dir, `${ONE}.git`))).toBe(true)
    expect(readFileSync(join(root, 'one', 'late.md'), 'utf8')).toContain('late')
  })
})
