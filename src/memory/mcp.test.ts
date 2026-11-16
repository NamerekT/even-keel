import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../storage/database.js'
import type { TasksScope } from '../taskmcp/calls.js'
import { isMemoryUrl, MemoryMcp } from './mcp.js'
import { memoryRecord } from './store.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const HUB: TasksScope = { project: PROJECT, task: 'ABC-2' }
const MACHINE: TasksScope = { project: PROJECT, task: 'ABC-3', machine: '88888888-8888-4888-8888-888888888888' }

let db: PGlite
let mcp: MemoryMcp
let id = 0

async function call(name: string, args: Record<string, unknown>, scope: TasksScope = HUB): Promise<{ text: string; error: boolean }> {
  const reply = (await mcp.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, scope)) as {
    result: { content: { text: string }[]; isError?: boolean }
  }
  return { text: reply.result.content[0]!.text, error: reply.result.isError === true }
}

const fact = { name: 'tests-need-docker', description: 'the integration tests need a running Docker', type: 'project', body: 'Start Docker first.' }

describe('the memory server (BTN-1029)', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    db = await openDatabase(undefined)
    mcp = new MemoryMcp({ db, now: () => new Date('2026-11-16T10:00:00.000Z') }, '0.0.0-test')
  })
  afterAll(() => db.close())
  beforeEach(() => db.exec('delete from memory_records'))

  it('knows its own address', () => {
    expect(isMemoryUrl('http://127.0.0.1:4748/memory')).toBe(true)
    expect(isMemoryUrl('http://localhost:4748/memory')).toBe(true)
    expect(isMemoryUrl('http://127.0.0.1:4748/tasks')).toBe(false)
    expect(isMemoryUrl('https://example.com/memory')).toBe(false)
  })

  it('keeps a new record at version 1, lists and reads it, and stamps its writer', async () => {
    expect(await call('memory_list', {})).toEqual({ text: 'The project memory is empty.', error: false })
    expect(await call('memory_write', fact, MACHINE)).toEqual({ text: 'Kept tests-need-docker, version 1.', error: false })
    expect((await call('memory_list', {})).text).toBe('- tests-need-docker — the integration tests need a running Docker (v1)')
    expect((await call('memory_read', { names: ['tests-need-docker', 'nothing'] })).text).toBe(
      '## tests-need-docker (version 1, project)\ndescription: the integration tests need a running Docker\n\nStart Docker first.\n\n## nothing\nThere is no such record.',
    )
    expect(await memoryRecord(db, PROJECT, fact.name)).toMatchObject({ task: 'ABC-3', machine: MACHINE.machine, at: '2026-11-16T10:00:00.000Z' })
  })

  it('refuses a stale change of two machines racing, with the current text, and takes the retry', async () => {
    await call('memory_write', fact)
    const first = call('memory_write', { ...fact, body: 'Start Docker; the hub machine has it.', version: 1 }, HUB)
    const second = call('memory_write', { ...fact, body: 'Start Docker and pull the images.', version: 1 }, MACHINE)
    const answers = await Promise.all([first, second])
    expect(answers.filter((each) => !each.error)).toEqual([{ text: 'Kept tests-need-docker, version 2.', error: false }])
    const refused = answers.find((each) => each.error)!
    expect(refused.text).toContain('changed since you read it')
    expect(refused.text).toContain('repeat the call with version 2')
    const kept = (await memoryRecord(db, PROJECT, fact.name))!.body
    expect(refused.text).toContain(kept)
    expect(await call('memory_write', { ...fact, body: `${kept}\nPull the images too.`, version: 2 }, MACHINE)).toEqual({ text: 'Kept tests-need-docker, version 3.', error: false })
  })

  it('lets a change of another record through', async () => {
    await call('memory_write', fact)
    await call('memory_write', { name: 'lint-before-merge', description: 'run the linter before a merge', type: 'feedback', body: 'npm run lint' })
    expect((await call('memory_write', { ...fact, body: 'changed', version: 1 })).error).toBe(false)
    expect((await call('memory_write', { name: 'lint-before-merge', description: 'run the linter before a merge', type: 'feedback', body: 'npm run lint --fix', version: 1 })).error).toBe(false)
  })

  it('refuses a new record under a live name, and a change of one that does not exist', async () => {
    await call('memory_write', fact)
    const again = await call('memory_write', { ...fact, distinct: true })
    expect(again.error).toBe(true)
    expect(again.text).toContain('already exists')
    expect(again.text).toContain('version 1')
    expect((await call('memory_write', { ...fact, name: 'other', version: 1 })).text).toBe('Not kept: there is no record other. To add it, write it without a version.')
  })

  it('shows similar records before a new one, and keeps it when told it is distinct', async () => {
    await call('memory_write', fact)
    const similar = { name: 'docker-for-tests', description: 'integration tests need Docker running', type: 'project', body: 'x' }
    const shown = await call('memory_write', similar)
    expect(shown.error).toBe(true)
    expect(shown.text).toContain('- tests-need-docker — the integration tests need a running Docker (v1)')
    expect((await call('memory_write', { ...similar, distinct: true })).text).toBe('Kept docker-for-tests, version 1.')
  })

  it('deletes at the version read, refuses a stale delete or change, and brings a deleted name back as a new version', async () => {
    await call('memory_write', fact)
    expect((await call('memory_delete', { name: fact.name, version: 2 })).text).toContain('changed since you read it')
    expect(await call('memory_delete', { name: fact.name, version: 1 })).toEqual({ text: 'Deleted tests-need-docker.', error: false })
    expect((await call('memory_write', { ...fact, version: 1 })).text).toContain('was deleted since you read it')
    expect((await call('memory_read', { names: [fact.name] })).text).toBe('## tests-need-docker\nDeleted (version 2).')
    expect((await call('memory_write', fact)).text).toBe('Kept tests-need-docker, version 3.')
  })

  it('refuses a bad name, type or version, and an address without a project', async () => {
    expect((await call('memory_write', { ...fact, name: 'Tests Need Docker' })).error).toBe(true)
    expect((await call('memory_write', { ...fact, type: 'note' })).text).toBe('type must be one of user, feedback, project, reference')
    expect((await call('memory_delete', { name: fact.name, version: 0 })).error).toBe(true)
    expect((await call('memory_list', {}, { project: null, task: null })).error).toBe(true)
  })

  it('takes a version sent as a string', async () => {
    await call('memory_write', fact)
    expect((await call('memory_write', { ...fact, body: 'y', version: '1' })).text).toBe('Kept tests-need-docker, version 2.')
  })
})
