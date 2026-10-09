import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSessionRecord, readTranscript } from './history.js'

const SESSION = '0a1b2c3d-1e04-43ce-b2ed-9b4a4eb36c23'

const entry = (timestamp: string, content: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp,
    cwd: 'C:\repos\example\.claude\worktrees\abc-1',
    gitBranch: 'abc-1/work',
    message: { id: timestamp, model: 'claude-opus-5-5', content, usage: { input_tokens: 10, output_tokens: 5 } },
    ...extra,
  })

describe('readSessionRecord', () => {
  let projects: string

  beforeEach(() => {
    projects = mkdtempSync(join(tmpdir(), 'even-keel-history-'))
  })

  afterEach(() => {
    rmSync(projects, { recursive: true, force: true })
  })

  it('finds the transcript in any project folder and sums it up in full', async () => {
    const dir = join(projects, 'C--repos-example--claude-worktrees-abc-1')
    mkdirSync(dir)
    const lines = Array.from({ length: 40 }, (_, index) =>
      entry(new Date(Date.UTC(2026, 8, 27, 10, index)).toISOString(), [{ type: 'text', text: `step ${index}` }]),
    )
    writeFileSync(join(dir, `${SESSION}.jsonl`), lines.join('\n') + '\n')

    const record = await readSessionRecord(projects, SESSION)
    expect(record).toMatchObject({
      sessionId: SESSION,
      startedAt: '2026-09-27T10:00:00.000Z',
      lastActivityAt: '2026-09-27T10:39:00.000Z',
      workdir: 'C:\repos\example\.claude\worktrees\abc-1',
      branch: 'abc-1/work',
      apiError: null,
    })
    expect(record?.feed).toHaveLength(40)
    expect(record?.tokens.input).toBe(400)
  })

  it('returns nothing for an unknown session and refuses ids that are not session ids', async () => {
    expect(await readSessionRecord(projects, SESSION)).toBeUndefined()
    await expect(readSessionRecord(projects, '../secrets')).rejects.toThrow('not a session id')
    expect(await readTranscript(projects, SESSION)).toBeUndefined()
    await expect(readTranscript(projects, '../secrets')).rejects.toThrow('not a session id')
  })

  it('reads the whole transcript with the first prompt and texts uncut', async () => {
    const dir = join(projects, 'C--repos-example')
    mkdirSync(dir)
    const long = 'word '.repeat(300).trim()
    const lines = [
      JSON.stringify({ type: 'user', timestamp: '2026-09-27T09:59:00.000Z', message: { role: 'user', content: 'ABC-1' } }),
      ...Array.from({ length: 40 }, (_, index) =>
        entry(new Date(Date.UTC(2026, 8, 27, 10, index)).toISOString(), [{ type: 'text', text: `${long} ${index}` }]),
      ),
    ]
    writeFileSync(join(dir, `${SESSION}.jsonl`), lines.join('\n') + '\n')

    const feed = await readTranscript(projects, SESSION)
    expect(feed).toHaveLength(41)
    expect(feed?.[0]).toMatchObject({ kind: 'prompt', text: 'ABC-1' })
    expect(feed?.[40]?.text).toBe(`${long} 39`)

    const tail = await readTranscript(projects, SESSION, 39)
    expect(tail?.map((line) => line.text)).toEqual([`${long} 38`, `${long} 39`])
    expect(await readTranscript(projects, SESSION, 41)).toEqual([])
  })
})
