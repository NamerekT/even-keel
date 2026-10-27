import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignState } from './db.js'
import { loadRollout, type FileState } from './load.js'
import { rolloutTurnsKey } from './rollout-turns.js'
import { refreshTurns } from './steps.js'
import { turnsKey, type Turn } from './turns.js'

const SESSION = '00000000-0000-4000-8000-000000000001'
const at = (minute: number) => `2026-10-01T10:0${minute}:00.000Z`
const event = (minute: number, type: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ timestamp: at(minute), type: 'event_msg', payload: { type, turn_id: 'turn1', ...extra } }) + '\n'
const rollout = event(0, 'task_started')
  + JSON.stringify({ timestamp: at(0), type: 'turn_context', payload: { model: 'gpt-6.1-terra' } }) + '\n'
  + event(1, 'token_count', { info: { total_token_usage: { total_tokens: 11 }, last_token_usage: { input_tokens: 10, output_tokens: 1 } } })
  + event(2, 'task_complete')

describe('refreshTurns with Codex sources', () => {
  let dir: string
  let state: SignState
  let written: Turn[]
  const sessionEntries = vi.fn(async () => [])
  const db = {
    turnStates: async () => [state],
    sessionEntries,
    writeTurns: async (_session: string, lastAt: string | null, key: string, turns: Turn[]) => {
      state = { ...state, signedAt: lastAt, key }
      written = turns
    },
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tally-turns-'))
    state = { sessionId: SESSION, lastAt: at(2), signedAt: at(2), key: turnsKey(true), launchReason: 'launch' }
    written = []
    sessionEntries.mockClear()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('backfills an unchanged, already loaded rollout, then skips it until the session changes', async () => {
    const source = { path: join(dir, `rollout-2026-10-01T10-00-00-${SESSION}.jsonl`), account: 'codex' }
    writeFileSync(source.path, rollout)
    let file: FileState | undefined
    const store = { files: async () => new Map(), write: async (_batch: unknown, current: FileState) => { file = current } }
    const context = { account: 'codex', launches: new Map() }
    expect(await loadRollout(source, file, store, context)).toBeGreaterThan(0)
    expect(await loadRollout(source, file, store, context)).toBe(0)

    expect(await refreshTurns(db, [source])).toBe(1)
    expect(state.key).toBe(rolloutTurnsKey(true))
    expect(written).toEqual([expect.objectContaining({ start: 'launch', replies: 1, endedAt: at(2) })])
    expect(sessionEntries).not.toHaveBeenCalled()
    expect(await refreshTurns(db, [source])).toBe(0)

    appendFileSync(source.path, event(3, 'task_started', { turn_id: 'turn2' })
      + event(4, 'token_count', { turn_id: 'turn2', info: { total_token_usage: { total_tokens: 22 }, last_token_usage: { input_tokens: 10, output_tokens: 1 } } })
      + event(5, 'task_complete', { turn_id: 'turn2' }))
    state.lastAt = at(5)
    expect(await refreshTurns(db, [source])).toBe(1)
    expect(written).toHaveLength(2)
    expect(written[1]).toMatchObject({ start: 'prompt', replies: 1, endedAt: at(5) })
  })

  it('reads compressed history again after a Codex parser version change', async () => {
    const source = { path: join(dir, `rollout-2026-10-01T10-00-00-${SESSION}.jsonl.zst`), account: 'codex' }
    writeFileSync(source.path, zstdCompressSync(rollout))
    state.key = 'codex:0:old'
    expect(await refreshTurns(db, [source])).toBe(1)
    expect(written[0]?.endedAt).toBe(at(2))
    expect(await refreshTurns(db, [])).toBe(0)
    expect(written).toHaveLength(1)
  })

  it('keeps Claude turns on the existing transcript path', async () => {
    state.key = null
    expect(await refreshTurns(db, [])).toBe(1)
    expect(sessionEntries).toHaveBeenCalledWith(SESSION)
    expect(state.key).toBe(turnsKey(true))
  })

  it('reports an unreadable rollout without marking its turns as computed', async () => {
    const onReadError = vi.fn()
    const source = { path: join(dir, `rollout-missing-${SESSION}.jsonl`), account: 'codex' }
    const previous = { ...state }
    expect(await refreshTurns(db, [source], onReadError)).toBe(0)
    expect(onReadError).toHaveBeenCalledWith(source.path, expect.objectContaining({ code: 'ENOENT' }))
    expect(state).toEqual(previous)
  })
})
