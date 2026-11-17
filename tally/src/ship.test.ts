import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileState } from './load.js'
import type { MachineRows } from './machine-rows.js'
import { shipToHub, slices, type MarkStore } from './ship.js'

class MemoryMarks implements MarkStore {
  states = new Map<string, FileState>()
  async marks() {
    return new Map(this.states)
  }
  async mark(file: FileState) {
    this.states.set(file.path, file)
  }
  async forgetExcept(paths: string[]) {
    const gone = [...this.states.keys()].filter((path) => !paths.includes(path))
    for (const path of gone) this.states.delete(path)
    return gone.length
  }
}

const line = (uuid: string) =>
  JSON.stringify({
    type: 'assistant', uuid, sessionId: 's1', timestamp: '2026-11-17T10:00:00.000Z', cwd: '/work/example',
    message: { id: `msg-${uuid}`, model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } },
  }) + '\n'

describe('shipToHub', () => {
  let dir: string
  let file: string
  let marks: MemoryMarks
  let sent: MachineRows[]
  const homes = () => [{ key: 'global', dir, global: true, agent: 'claude' }]
  const log = () => {}

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tally-ship-'))
    mkdirSync(join(dir, 'projects', 'example'), { recursive: true })
    file = join(dir, 'projects', 'example', 's1.jsonl')
    marks = new MemoryMarks()
    sent = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const taking = async (rows: MachineRows) => {
    sent.push(rows)
    return true
  }

  it('sends the rows of a new transcript once and moves its mark after the hub took them', async () => {
    appendFileSync(file, line('a') + line('b'))
    expect(await shipToHub(homes(), marks, taking, log)).toMatchObject({ state: 'done', files: 1, lines: 2 })
    expect(sent.flatMap((rows) => rows.lines.map((row) => row.uuid))).toEqual(['a', 'b'])
    expect(sent.flatMap((rows) => rows.messages.map((row) => [row.messageId, row.account]))).toEqual([['msg-a', 'global'], ['msg-b', 'global']])
    expect(marks.states.get(file)?.offset).toBeGreaterThan(0)

    sent = []
    expect(await shipToHub(homes(), marks, taking, log)).toMatchObject({ state: 'done', files: 0 })
    expect(sent).toEqual([])

    appendFileSync(file, line('c'))
    await shipToHub(homes(), marks, taking, log)
    expect(sent.flatMap((rows) => rows.lines.map((row) => row.uuid))).toEqual(['c'])
  })

  it('keeps the mark where it was when the hub does not take the rows, and sends them again next time', async () => {
    appendFileSync(file, line('a'))
    expect(await shipToHub(homes(), marks, async () => false, log)).toMatchObject({ state: 'away' })
    expect(marks.states.has(file)).toBe(false)

    await shipToHub(homes(), marks, taking, log)
    expect(sent.flatMap((rows) => rows.lines.map((row) => row.uuid))).toEqual(['a'])
  })

  it('drops the marks of transcripts gone from the folders', async () => {
    marks.states.set('/gone.jsonl', { path: '/gone.jsonl', account: 'global', offset: 1, size: 1, mtime: '', ino: '', head: '', headLen: 0 })
    expect(await shipToHub(homes(), marks, taking, log)).toMatchObject({ state: 'done', forgotten: 1 })
  })
})

describe('slices', () => {
  const rows = (count: number): MachineRows => ({
    lines: Array.from({ length: count }, (_, at) => ({ uuid: `u${at}`, sessionId: 's', agentId: null, type: 'user', at: null, raw: { text: 'x'.repeat(100) } })),
    messages: [], calls: [], results: [], sessions: [],
  })

  it('cuts the rows into posts under the limit, every row in exactly one', () => {
    const parts = slices(rows(10), 400)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.flatMap((part) => part.lines.map((row) => row.uuid))).toEqual(rows(10).lines.map((row) => row.uuid))
  })

  it('gives no post for no rows', () => {
    expect(slices(rows(0), 400)).toEqual([])
  })
})
