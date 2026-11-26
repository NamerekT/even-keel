import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TasksScope } from '../taskmcp/calls.js'
import { savedMarks, saveConflicts } from './git/conflicts.js'
import type { MemoryHub } from './git/hub.js'
import { isMemoryUrl, MemoryMcp } from './mcp.js'
import { fileHash } from './record.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const HUB: TasksScope = { project: PROJECT, task: 'ABC-2' }
const MACHINE: TasksScope = { project: PROJECT, task: 'ABC-3', machine: '88888888-8888-4888-8888-888888888888' }

let folder: string
let mcp: MemoryMcp
let wrote: boolean[]
let id = 0

/** The hub's `within`: one step at a time, as `MemorySync.edit` chains them. */
function fakeHub(): Pick<MemoryHub, 'within'> {
  let current: Promise<unknown> = Promise.resolve()
  return {
    within: <T>(project: string, step: (dir: string | null) => T, write = false): Promise<T> => {
      const run = current.then(() => {
        const value = step(project === PROJECT ? folder : null)
        if (write) wrote.push(true)
        return value
      })
      current = run.catch(() => undefined)
      return run
    },
  }
}

async function call(name: string, args: Record<string, unknown>, scope: TasksScope = HUB): Promise<{ text: string; error: boolean }> {
  const reply = (await mcp.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, scope)) as {
    result: { content: { text: string }[]; isError?: boolean }
  }
  return { text: reply.result.content[0]!.text, error: reply.result.isError === true }
}

/** The version `memory_write` reported. */
function keptVersion(text: string): number {
  const found = /version (\d+)\.$/.exec(text)
  if (found === null) throw new Error(`no version in ${text}`)
  return Number(found[1])
}

const fact = { name: 'tests-need-docker', description: 'the integration tests need a running Docker', type: 'project', body: 'Start Docker first.' }

describe('the memory server over the working copy (BTN-1029, BTN-1646)', () => {
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'ek-memory-mcp-'))
    wrote = []
    mcp = new MemoryMcp({ hub: fakeHub() }, '0.0.0-test')
  })
  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  it('knows its own address', () => {
    expect(isMemoryUrl('http://127.0.0.1:4748/memory')).toBe(true)
    expect(isMemoryUrl('http://localhost:4748/memory')).toBe(true)
    expect(isMemoryUrl('http://127.0.0.1:4748/tasks')).toBe(false)
    expect(isMemoryUrl('https://example.com/memory')).toBe(false)
  })

  it('keeps a new record as a file with its index line, lists and reads it', async () => {
    expect(await call('memory_list', {})).toEqual({ text: 'The project memory is empty.', error: false })
    const kept = await call('memory_write', fact, MACHINE)
    expect(kept.error).toBe(false)
    const version = keptVersion(kept.text)
    expect(wrote).toEqual([true])
    expect(readFileSync(join(folder, 'tests-need-docker.md'), 'utf8')).toContain('Start Docker first.')
    expect(readFileSync(join(folder, 'MEMORY.md'), 'utf8')).toContain('](tests-need-docker.md) — the integration tests need a running Docker')
    expect((await call('memory_list', {})).text).toBe(`- tests-need-docker — the integration tests need a running Docker (v${version})`)
    expect((await call('memory_read', { names: ['tests-need-docker', 'nothing'] })).text).toBe(
      `## tests-need-docker (version ${version}, project)\ndescription: the integration tests need a running Docker\n\nStart Docker first.\n\n## nothing\nThere is no such record.`,
    )
  })

  it('refuses a stale change of two machines racing, with the current text, and takes the retry', async () => {
    const v1 = keptVersion((await call('memory_write', fact)).text)
    const first = call('memory_write', { ...fact, body: 'Start Docker; the hub machine has it.', version: v1 }, HUB)
    const second = call('memory_write', { ...fact, body: 'Start Docker and pull the images.', version: v1 }, MACHINE)
    const answers = await Promise.all([first, second])
    const taken = answers.filter((each) => !each.error)
    expect(taken).toHaveLength(1)
    const v2 = keptVersion(taken[0]!.text)
    const refused = answers.find((each) => each.error)!
    expect(refused.text).toContain('changed since you read it')
    expect(refused.text).toContain(`repeat the call with version ${v2}`)
    expect(refused.text).toContain('Start Docker; the hub machine has it.')
    expect((await call('memory_write', { ...fact, body: 'Start Docker; the hub machine has it.\nPull the images too.', version: v2 }, MACHINE)).error).toBe(false)
  })

  it('takes a hand edit of the file as a new version', async () => {
    const v1 = keptVersion((await call('memory_write', fact)).text)
    const path = join(folder, 'tests-need-docker.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace('first', 'before the tests'))
    const stale = await call('memory_write', { ...fact, body: 'x', version: v1 })
    expect(stale.text).toContain('Start Docker before the tests.')
  })

  it('writes into the file a record already has, whatever its name', async () => {
    writeFileSync(join(folder, 'docker.md'), '---\nname: tests-need-docker\ndescription: old\ntype: project\n---\n\nold body\n')
    const read = (await call('memory_read', { names: [fact.name] })).text
    const version = Number(/version (\d+),/.exec(read)![1])
    expect((await call('memory_write', { ...fact, version })).error).toBe(false)
    expect(readFileSync(join(folder, 'docker.md'), 'utf8')).toContain('Start Docker first.')
  })

  it('refuses a new record under a live name, and a change of one that does not exist', async () => {
    const v1 = keptVersion((await call('memory_write', fact)).text)
    const again = await call('memory_write', { ...fact, distinct: true })
    expect(again.error).toBe(true)
    expect(again.text).toContain('already exists')
    expect(again.text).toContain(`version ${v1}`)
    expect((await call('memory_write', { ...fact, name: 'other', version: 1 })).text).toBe(
      'Not kept: there is no record other: it was deleted, or never written. To add it, write it without a version.',
    )
  })

  it('shows similar records before a new one, and keeps it when told it is distinct', async () => {
    const v1 = keptVersion((await call('memory_write', fact)).text)
    const similar = { name: 'docker-for-tests', description: 'integration tests need Docker running', type: 'project', body: 'x' }
    const shown = await call('memory_write', similar)
    expect(shown.error).toBe(true)
    expect(shown.text).toContain(`- tests-need-docker — the integration tests need a running Docker (v${v1})`)
    expect((await call('memory_write', { ...similar, distinct: true })).error).toBe(false)
  })

  it('deletes at the version read, refuses a stale delete, and a change after the delete', async () => {
    const v1 = keptVersion((await call('memory_write', fact)).text)
    expect((await call('memory_delete', { name: fact.name, version: v1 + 1 })).text).toContain('changed since you read it')
    expect(await call('memory_delete', { name: fact.name, version: v1 })).toEqual({ text: 'Deleted tests-need-docker.', error: false })
    expect(readFileSync(join(folder, 'MEMORY.md'), 'utf8')).not.toContain('tests-need-docker')
    expect((await call('memory_write', { ...fact, version: v1 })).text).toContain('there is no record tests-need-docker')
    expect((await call('memory_read', { names: [fact.name] })).text).toBe('## tests-need-docker\nThere is no such record.')
    expect((await call('memory_write', fact)).error).toBe(false)
  })

  it('refuses a bad name, type or version, an address without a project, and a project without a folder', async () => {
    expect((await call('memory_write', { ...fact, name: 'Tests Need Docker' })).error).toBe(true)
    expect((await call('memory_write', { ...fact, type: 'note' })).text).toBe('type must be one of user, feedback, project, reference')
    expect((await call('memory_delete', { name: fact.name, version: 0 })).error).toBe(true)
    expect((await call('memory_list', {}, { project: null, task: null })).error).toBe(true)
    expect((await call('memory_list', {}, { project: '22222222-2222-4222-8222-222222222222', task: null })).text).toContain('no memory folder')
  })

  it('takes a version sent as a string', async () => {
    const v1 = keptVersion((await call('memory_write', fact)).text)
    expect((await call('memory_write', { ...fact, body: 'y', version: String(v1) })).error).toBe(false)
  })

  it('tells of a record in a sync conflict in the answers of memory_read and memory_write until it is saved (BTN-1686)', async () => {
    await call('memory_write', fact)
    const file = `${fact.name}.md`
    const text = readFileSync(join(folder, file), 'utf8')
    const conflict = { file, commit: 'c1', other: 'c0', since: '2026-11-24T20:46:00Z', hash: fileHash(text), otherText: 'Start Podman first.\n', note: '' }
    saveConflicts(folder, [conflict])
    const read = (await call('memory_read', { names: [fact.name] })).text
    expect(read).toContain('Start Docker first.')
    expect(read).toContain(`The project memory record ${fact.name} is in a sync conflict`)
    expect(read).toContain('Start Podman first.')
    const merged = await call('memory_write', { ...fact, body: 'Start Docker or Podman first.', version: keptVersion(read.split('\n')[0]!.replace(/^.*version (\d+).*$/, 'version $1.')) })
    expect(merged.text).toMatch(/^Kept tests-need-docker, version \d+\.$/)
    expect((await call('memory_read', { names: [fact.name] })).text).not.toContain('sync conflict')
  })

  it('takes a write of the record with its text unchanged as the end of its conflict (BTN-1746)', async () => {
    const v1 = keptVersion((await call('memory_write', fact)).text)
    const file = `${fact.name}.md`
    const conflict = { file, commit: 'c1', other: 'c0', since: '2026-11-24T20:46:00Z', hash: fileHash(readFileSync(join(folder, file), 'utf8')), otherText: 'Start Podman first.\n', note: '' }
    saveConflicts(folder, [conflict])
    expect((await call('memory_read', { names: [fact.name] })).text).toContain('sync conflict')
    const same = await call('memory_write', { ...fact, version: v1 })
    expect(same.text).toBe(`Kept tests-need-docker, version ${v1}.`)
    expect(savedMarks(folder)).toEqual([{ file, hash: conflict.hash }])
    expect((await call('memory_read', { names: [fact.name] })).text).not.toContain('sync conflict')
  })
})
