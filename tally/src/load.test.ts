import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFile, loadRollout, startOf, type FileState, type Store } from './load.js'
import { launchMap, type Batch } from './parse.js'

class MemoryStore implements Store {
  states = new Map<string, FileState>()
  writes: string[] = []

  async files() {
    return new Map(this.states)
  }

  async write(batch: Batch, file: FileState) {
    this.writes.push(...batch.lines.keys())
    this.states.set(file.path, file)
  }
}

function line(uuid: string, text = 'hi') {
  return JSON.stringify({ type: 'user', uuid, sessionId: 's1', timestamp: '2026-10-03T10:00:00.000Z', message: { content: text } }) + '\n'
}

const context = { account: 'global', launches: launchMap([]) }

describe('loadFile', () => {
  let dir: string
  let file: string
  let store: MemoryStore

  const load = (chunkBytes = 1 << 20) => loadFile({ path: file, account: 'global' }, store.states.get(file), store, context, chunkBytes)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tally-'))
    file = join(dir, 's1.jsonl')
    store = new MemoryStore()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads only the new tail and leaves a half-written line for later', async () => {
    writeFileSync(file, line('u1') + line('u2'))
    await load()
    appendFileSync(file, line('u3') + '{"type":"user","uuid":"u4"')
    await load()
    expect(store.writes).toEqual(['u1', 'u2', 'u3'])
    await load()
    expect(store.writes).toEqual(['u1', 'u2', 'u3'])
    appendFileSync(file, ',"sessionId":"s1"}\n')
    await load()
    expect(store.writes).toEqual(['u1', 'u2', 'u3', 'u4'])
  })

  it('rereads a file that was cut or rewritten', async () => {
    writeFileSync(file, line('u1') + line('u2'))
    await load()
    writeFileSync(file, line('u9'))
    await load()
    expect(store.writes).toEqual(['u1', 'u2', 'u9'])
  })

  it('splits a large tail into chunks and grows the chunk for a long line', async () => {
    writeFileSync(file, line('u1') + line('u2', 'x'.repeat(400)) + line('u3'))
    await load(64)
    expect(store.writes).toEqual(['u1', 'u2', 'u3'])
  })
})

describe('loadRollout', () => {
  const session = '01a14a11-16af-7a80-acdb-6fb33607c527'
  let dir: string
  let store: MemoryStore
  let messages: string[]

  const rollout = (total: number) =>
    [
      JSON.stringify({ timestamp: '2026-10-17T13:33:16.710Z', type: 'session_meta', payload: { id: session, cwd: 'D:\\p', originator: 'codex_exec' } }),
      JSON.stringify({ timestamp: '2026-10-17T13:33:18.000Z', type: 'turn_context', payload: { model: 'gpt-5.6-luna' } }),
      JSON.stringify({
        timestamp: '2026-10-17T13:34:34.216Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { last_token_usage: { input_tokens: total, output_tokens: 1 }, total_token_usage: { total_tokens: total } } },
      }),
    ].join('\n') + '\n'

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tally-'))
    store = new MemoryStore()
    messages = []
    store.write = async (batch, file) => {
      messages.push(...batch.messages.keys())
      store.states.set(file.path, file)
    }
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const load = (path: string) => loadRollout({ path, account: 'codex' }, store.states.get(path), store, { account: 'codex', launches: launchMap([]) })

  it('reads a plain rollout whole each time it changed, and a compressed one', async () => {
    const plain = join(dir, `rollout-2026-10-17T15-33-16-${session}.jsonl`)
    writeFileSync(plain, rollout(10))
    expect(await load(plain)).toBe(3)
    expect(await load(plain)).toBe(0)
    appendFileSync(plain, rollout(20))
    expect(await load(plain)).toBe(6)
    expect(messages).toEqual([`codex:${session}:10`, `codex:${session}:10`, `codex:${session}:20`])
    expect(store.states.get(plain)?.offset).toBe(store.states.get(plain)?.size)

    const packed = join(dir, `rollout-2026-08-16T22-38-38-${session}.jsonl.zst`)
    writeFileSync(packed, zstdCompressSync(rollout(30)))
    expect(await load(packed)).toBe(3)
    expect(messages.at(-1)).toBe(`codex:${session}:30`)
  })
})

describe('startOf', () => {
  const stored: FileState = { path: 'f', account: 'global', offset: 100, size: 120, mtime: 't', ino: '7', head: 'h', headLen: 50 }

  it('reads a new file from the start', () => {
    expect(startOf(undefined, { size: 10, ino: '7', head: '' })).toBe(0)
  })

  it('reads from the stored offset when the file grew', () => {
    expect(startOf(stored, { size: 200, ino: '7', head: 'h' })).toBe(100)
  })

  it('skips a file with nothing new', () => {
    expect(startOf(stored, { size: 100, ino: '7', head: 'h' })).toBeNull()
  })

  it('rereads when the file shrank, was replaced or its head changed', () => {
    expect(startOf(stored, { size: 50, ino: '7', head: 'h' })).toBe(0)
    expect(startOf(stored, { size: 200, ino: '8', head: 'h' })).toBe(0)
    expect(startOf(stored, { size: 200, ino: '7', head: 'other' })).toBe(0)
  })
})
