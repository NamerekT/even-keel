import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database.js'
import { MemoryMcp } from './mcp.js'
import { MemoryMirror } from './mirror.js'
import { memoryFile, parseMemoryFile } from './record.js'
import { memoryRecord, memoryRecords } from './store.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const scope = { project: PROJECT, task: 'ABC-2' }

let db: PGlite
let folder: string
let mirror: MemoryMirror
let mcp: MemoryMcp
let id = 0

const call = async (name: string, args: Record<string, unknown>) => {
  const reply = (await mcp.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, scope)) as { result: { content: { text: string }[] } }
  return reply.result.content[0]!.text
}
const read = (file: string) => readFileSync(join(folder, file), 'utf8')

const HAND = `---
name: address-informal
description: talk to the user informally
metadata:
  type: feedback
---

Use the informal form.

**Why:** the user asked.
`

describe("the hub's memory folder and the records (BTN-1029)", { timeout: 120_000 }, () => {
  beforeAll(async () => {
    db = await openDatabase(undefined)
  })
  afterAll(() => db.close())
  beforeEach(async () => {
    await db.exec('delete from memory_records')
    folder = join(mkdtempSync(join(tmpdir(), 'memory-')), 'project')
    mkdirSync(folder)
    mirror = new MemoryMirror({ db, folderOf: () => folder, now: () => new Date('2026-11-16T10:00:00.000Z'), log: () => {} })
    mcp = new MemoryMcp({ db, mirror, now: () => new Date('2026-11-16T10:00:00.000Z') }, '0.0.0-test')
    return () => rmSync(join(folder, '..'), { recursive: true, force: true })
  })

  it('reads a file as the CLI writes it, and writes one it reads back', () => {
    expect(parseMemoryFile(HAND, 'x')).toEqual({ name: 'address-informal', description: 'talk to the user informally', type: 'feedback', body: 'Use the informal form.\n\n**Why:** the user asked.' })
    expect(parseMemoryFile('---\nname: "quoted"\ntype: user\n---\nbody', 'x')).toEqual({ name: 'quoted', description: '', type: 'user', body: 'body' })
    expect(parseMemoryFile('# A note\n\ntext\n', 'stem')).toMatchObject({ name: 'stem', description: 'A note' })
    const fact = { name: 'a', description: 'b', type: 'project', body: 'c\nd' }
    expect(parseMemoryFile(memoryFile(fact), 'z')).toEqual(fact)
  })

  it('takes the files of a hand session into records, MEMORY.md aside, and sees a hand edit as a new version', async () => {
    writeFileSync(join(folder, 'address-informal-ty.md'), HAND)
    writeFileSync(join(folder, 'MEMORY.md'), '- [Address](address-informal-ty.md) — informal\n')
    expect(await call('memory_list', {})).toBe('- address-informal — talk to the user informally (v1)')
    expect(await memoryRecord(db, PROJECT, 'address-informal')).toMatchObject({ file: 'address-informal-ty.md', task: null })
    expect(await call('memory_list', {})).toContain('(v1)')
    writeFileSync(join(folder, 'address-informal-ty.md'), HAND.replace('Use the informal form.', 'Use the informal form, always.'))
    expect(await call('memory_list', {})).toContain('(v2)')
    expect((await memoryRecord(db, PROJECT, 'address-informal'))!.body).toContain('always.')
  })

  it("gives a session's prompt the index of the live records, the folder's hand files taken first", async () => {
    expect(await mirror.index(PROJECT)).toEqual([])
    writeFileSync(join(folder, 'address-informal-ty.md'), HAND)
    expect(await mirror.index(PROJECT)).toEqual(['- address-informal — talk to the user informally'])
    unlinkSync(join(folder, 'address-informal-ty.md'))
    expect(await mirror.index(PROJECT)).toEqual([])
  })

  it("writes a session's new record into the folder and its MEMORY.md line, keeping the person's lines", async () => {
    writeFileSync(join(folder, 'MEMORY.md'), 'A note of the person.\n- [Address](address-informal-ty.md) — informal\n')
    writeFileSync(join(folder, 'address-informal-ty.md'), HAND)
    await call('memory_write', { name: 'tests-need-docker', description: 'tests need Docker', type: 'project', body: 'Start it.' })
    expect(parseMemoryFile(read('tests-need-docker.md'), 'x')).toEqual({ name: 'tests-need-docker', description: 'tests need Docker', type: 'project', body: 'Start it.' })
    expect(read('MEMORY.md')).toBe('A note of the person.\n- [Address](address-informal-ty.md) — informal\n- [tests-need-docker](tests-need-docker.md) — tests need Docker\n')
    // A change of the body keeps the person's title and hook; a new description replaces the hook only.
    await call('memory_write', { name: 'address-informal', description: 'talk to the user informally', type: 'feedback', body: 'Informal.', version: 1 })
    expect(read('address-informal-ty.md')).toContain('Informal.')
    expect(read('MEMORY.md')).toContain('- [Address](address-informal-ty.md) — informal\n')
    await call('memory_write', { name: 'address-informal', description: 'informal address only', type: 'feedback', body: 'Informal.', version: 2 })
    expect(read('MEMORY.md')).toContain('- [Address](address-informal-ty.md) — informal address only\n')
    // The session's own write is not taken back from the folder as a hand edit.
    expect(await call('memory_list', {})).toContain('address-informal — informal address only (v3)')
  })

  it("removes a deleted record's file and line, and deletes a record whose file a person removed", async () => {
    writeFileSync(join(folder, 'address-informal-ty.md'), HAND)
    writeFileSync(join(folder, 'MEMORY.md'), '- [Address](address-informal-ty.md) — informal\n')
    await call('memory_write', { name: 'tests-need-docker', description: 'tests need Docker', type: 'project', body: 'Start it.' })
    await call('memory_delete', { name: 'address-informal', version: 1 })
    expect(existsSync(join(folder, 'address-informal-ty.md'))).toBe(false)
    expect(read('MEMORY.md')).toBe('- [tests-need-docker](tests-need-docker.md) — tests need Docker\n')
    unlinkSync(join(folder, 'tests-need-docker.md'))
    expect(await call('memory_list', {})).toBe('The project memory is empty.')
    expect(await memoryRecord(db, PROJECT, 'tests-need-docker')).toMatchObject({ deleted: true, version: 2, file: null })
  })

  it('follows a name a person changed in the file, and a hand edit refuses a session that read the version before', async () => {
    writeFileSync(join(folder, 'address-informal-ty.md'), HAND)
    await mirror.pull(PROJECT)
    writeFileSync(join(folder, 'address-informal-ty.md'), HAND.replace('name: address-informal', 'name: informal-address'))
    await mirror.pull(PROJECT)
    expect((await memoryRecords(db, PROJECT)).map((record) => record.name)).toEqual(['informal-address'])
    writeFileSync(join(folder, 'address-informal-ty.md'), HAND.replace('name: address-informal', 'name: informal-address').replace('form.', 'form!'))
    expect(await call('memory_write', { name: 'informal-address', description: 'd', type: 'feedback', body: 'b', version: 1 })).toContain('changed since you read it')
  })

  it('mirrors a record the folder missed, and leaves a project without a folder alone', async () => {
    const lone = new MemoryMcp({ db, now: () => new Date() }, '0')
    await lone.call('memory_write', { name: 'missed', description: 'written while the folder was away', type: 'project', body: 'b' }, scope)
    await mirror.pull(PROJECT)
    expect(read('missed.md')).toContain('written while the folder was away')
    expect(await memoryRecord(db, PROJECT, 'missed')).toMatchObject({ file: 'missed.md', version: 1 })
    const none = new MemoryMirror({ db, folderOf: () => null, now: () => new Date(), log: () => {} })
    await none.pull(PROJECT)
  })
})

describe("a folder new to the mirror and a mass deletion (BTN-1556)", { timeout: 120_000 }, () => {
  const write = (name: string) => call('memory_write', { name, description: `about ${name}`, type: 'project', body: `${name} body` })
  const live = async () => (await memoryRecords(db, PROJECT)).map((record) => `${record.name} v${record.version}`)
  let lines: string[]

  beforeAll(async () => {
    db = await openDatabase(undefined)
  })
  afterAll(() => db.close())
  beforeEach(async () => {
    await db.exec('delete from memory_records')
    const root = mkdtempSync(join(tmpdir(), 'memory-'))
    folder = join(root, 'old')
    mkdirSync(folder)
    lines = []
    mirror = new MemoryMirror({ db, folderOf: () => folder, now: () => new Date('2026-11-23T10:00:00.000Z'), log: (line) => lines.push(line) })
    mcp = new MemoryMcp({ db, mirror, now: () => new Date('2026-11-23T10:00:00.000Z') }, '0.0.0-test')
    for (const name of ['alpha', 'beta', 'gamma']) await write(name)
    return () => rmSync(root, { recursive: true, force: true })
  })

  it("writes every record into a folder that is not there yet, a session's write first, and deletes none", async () => {
    folder = join(folder, '..', 'moved')
    await write('delta')
    expect(existsSync(join(folder, 'delta.md'))).toBe(true)
    await mirror.pull(PROJECT)
    expect(await live()).toEqual(['alpha v1', 'beta v1', 'delta v1', 'gamma v1'])
    for (const name of ['alpha', 'beta', 'gamma', 'delta']) expect(read(`${name}.md`)).toContain(`${name} body`)
    expect(read('MEMORY.md').split('\n').filter(Boolean)).toHaveLength(4)
    // Mirrored now: a file a person removes deletes its record again.
    unlinkSync(join(folder, 'beta.md'))
    await mirror.pull(PROJECT)
    expect(await live()).toEqual(['alpha v1', 'delta v1', 'gamma v1'])
  })

  it("writes every record into the folder of a project's new repo, and keeps the versions of files copied there", async () => {
    const copied = join(folder, '..', 'copied')
    mkdirSync(copied)
    writeFileSync(join(copied, 'alpha.md'), read('alpha.md'))
    folder = copied
    await mirror.pull(PROJECT)
    expect(await live()).toEqual(['alpha v1', 'beta v1', 'gamma v1'])
    expect(read('beta.md')).toContain('beta body')
    expect(read('gamma.md')).toContain('gamma body')
    folder = join(copied, '..', 'empty')
    mkdirSync(folder)
    await mirror.pull(PROJECT)
    expect(await live()).toEqual(['alpha v1', 'beta v1', 'gamma v1'])
    expect(read('alpha.md')).toContain('alpha body')
  })

  it('takes no more than half of the records away in one pull: it writes their files back and says so in the log', async () => {
    unlinkSync(join(folder, 'alpha.md'))
    unlinkSync(join(folder, 'beta.md'))
    await mirror.pull(PROJECT)
    expect(await live()).toEqual(['alpha v1', 'beta v1', 'gamma v1'])
    expect(read('alpha.md')).toContain('alpha body')
    expect(read('beta.md')).toContain('beta body')
    expect(lines.join('\n')).toMatch(/2 of 3 files left the hub's folder at once: kept/)
    unlinkSync(join(folder, 'alpha.md'))
    await mirror.pull(PROJECT)
    expect(await live()).toEqual(['beta v1', 'gamma v1'])
  })
})
