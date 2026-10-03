import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadFile, startOf, type FileState, type Store } from './load.js'
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
