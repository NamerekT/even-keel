import { beforeEach, describe, expect, it } from 'vitest'
import type { HandoffNote, NoteRefusal } from '../chain/handoff-note.js'
import type { TasksDeps, TasksScope } from './calls.js'
import { SESSION_META } from './carried.js'
import { NOTE_KEPT } from './handoff.js'
import { TasksMcp } from './server.js'

const SCOPE: TasksScope = { project: 'p1', task: 'ABC-1', machine: 'm1' }
const WRITER = { session: 's-2', branch: 'abc-1/parser', at: '2026-11-16T10:00:00.000Z' }

let notes: HandoffNote[]
let refusal: NoteRefusal | null

const server = (writeNote: TasksDeps['writeNote'] = async (note) => (refusal === null ? void notes.push(note) ?? null : refusal)) =>
  new TasksMcp({ db: undefined as never, readers: () => [], run: async () => undefined as never, modelOf: () => null, writeNote } as unknown as TasksDeps, '1')

const call = (args: Record<string, unknown>, writer?: typeof WRITER) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'handoff_write', arguments: args, ...(writer === undefined ? {} : { _meta: { [SESSION_META]: { attach: {}, downloads: false, writer } } }) },
})
const answer = (reply: Record<string, unknown> | null) => reply!.result as { content: { text: string }[]; isError?: boolean }

beforeEach(() => {
  notes = []
  refusal = null
})

describe('handoff_write on the hub (BTN-1046)', () => {
  it('keeps the note of the call’s task with the session, branch and machine that wrote it', async () => {
    const reply = answer(await server().handle(call({ text: 'Done: the lexer. Next: npm test' }, WRITER), SCOPE))
    expect(reply).toEqual({ content: [{ type: 'text', text: NOTE_KEPT }] })
    expect(notes).toEqual([{ project: 'p1', task: 'ABC-1', sessionId: 's-2', branch: 'abc-1/parser', machine: 'm1', at: WRITER.at, note: 'Done: the lexer. Next: npm test' }])
  })

  it('refuses the note of a session the task was handed away from, and keeps nothing', async () => {
    refusal = 'stale'
    const reply = answer(await server().handle(call({ text: 'late' }, WRITER), SCOPE))
    expect(reply.isError).toBe(true)
    expect(reply.content[0]!.text).toMatch(/no longer the current session of ABC-1/)
    expect(notes).toEqual([])
  })

  it('refuses a call without a writer, an empty note and a session started by hand', async () => {
    expect(answer(await server().handle(call({ text: 'note' }), SCOPE)).content[0]!.text).toMatch(/could not tell which session/)
    expect(answer(await server().handle(call({ text: '  ' }, WRITER), SCOPE)).content[0]!.text).toMatch(/required|empty/)
    expect(answer(await server().handle(call({ text: 'note' }, WRITER), { project: 'p1', task: null })).content[0]!.text).toMatch(/only for a chain session/)
    expect(notes).toEqual([])
  })

  it('lists the tool only for an address that names the task', async () => {
    const names = async (scope: TasksScope) => ((await server().handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, scope))!.result as { tools: { name: string }[] }).tools.map((tool) => tool.name)
    expect(await names(SCOPE)).toContain('handoff_write')
    expect(await names({ project: 'p1', task: null })).not.toContain('handoff_write')
  })
})
