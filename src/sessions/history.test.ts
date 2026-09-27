import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSessionRecord } from './history.js'

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
    projects = mkdtempSync(join(tmpdir(), 'baton-history-'))
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
  })
})
