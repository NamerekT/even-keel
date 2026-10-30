import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROMPTS } from '../../src/chain/prompts.js'
import { CopilotTurnBuilder, copilotTurnSources } from './copilot-turns.js'

const at = (seconds: number) => new Date(Date.parse('2026-10-01T10:00:00Z') + seconds * 1000).toISOString()
const event = (seconds: number, type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type, data, id: `e${seconds}`, timestamp: at(seconds), ...extra })
const usage = (seconds: number, extra: Record<string, unknown> = {}) =>
  event(seconds, 'session.usage_record', { usage: { model: 'gpt-6-luna', inputTokens: 100, outputTokens: 10 } }, extra)

function turns(lines: string[], launched = false) {
  const builder = new CopilotTurnBuilder(launched)
  for (const text of lines) builder.push(text)
  return builder.finish()
}

describe('Copilot turns', () => {
  it("spans a user message to the turn's last activity over its model steps, counting each model call once", () => {
    expect(turns([
      event(0, 'session.start', { context: { cwd: '/work' } }),
      event(1, 'user.message', { content: 'DEMO-1' }),
      event(2, 'assistant.turn_start', { turnId: '0' }),
      usage(5),
      event(6, 'tool.execution_start', { toolName: 'powershell' }),
      event(40, 'tool.execution_complete', { success: true }),
      event(41, 'assistant.turn_end', { turnId: '0' }),
      event(41.5, 'assistant.turn_start', { turnId: '1' }),
      usage(50),
      usage(55, { agentId: 'explore-1' }),
      event(60, 'assistant.turn_end', { turnId: '1' }),
      event(62, 'session.usage_checkpoint'),
      event(63, 'session.shutdown'),
      event(100, 'session.resume', { context: { cwd: '/work' } }),
      event(101, 'user.message', { content: 'and the tests?' }),
      usage(110),
      event(111, 'assistant.turn_end', { turnId: '0' }),
    ], true)).toEqual([
      { startUuid: 'e1', start: 'launch', startedAt: at(1), endedAt: at(60), replies: 2, askSeconds: 0, limited: false, cliSeconds: null },
      { startUuid: 'e101', start: 'prompt', startedAt: at(101), endedAt: at(111), replies: 1, askSeconds: 0, limited: false, cliSeconds: null },
    ])
  })

  it("takes a resume prompt, marks a limit error and ignores a subagent's message and events before any prompt", () => {
    const found = turns([
      usage(0),
      event(1, 'user.message', { content: 'DEMO-1' }),
      usage(2),
      event(3, 'user.message', { content: 'explore' }, { agentId: 'explore-1' }),
      event(4, 'session.error', { errorType: 'rate_limit', message: 'Too many requests' }),
      event(50, 'user.message', { content: `${PROMPTS.ru.resume}\n` }),
      usage(51),
      event(52, 'session.error', { errorType: 'other', message: 'boom' }),
    ], true)
    expect(found.map(({ startUuid, start, endedAt, limited }) => ({ startUuid, start, endedAt, limited }))).toEqual([
      { startUuid: 'e1', start: 'launch', endedAt: at(4), limited: true },
      { startUuid: 'e50', start: 'resume', endedAt: at(52), limited: false },
    ])
  })
})

describe('copilotTurnSources', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('reads the turns of each events file under its session id and skips a file outside session-state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tally-copilot-turns-'))
    dirs.push(dir)
    const folder = join(dir, 'session-state', 'c8fdf4bc-0000-4000-8000-000000000001')
    mkdirSync(folder, { recursive: true })
    const path = join(folder, 'events.jsonl')
    writeFileSync(path, [event(1, 'user.message', { content: 'DEMO-1' }), usage(5), ''].join('\n'))
    const sources = copilotTurnSources([{ path, account: 'copilot' }, { path: join(dir, 'events.jsonl'), account: 'copilot' }])
    expect(sources.map((source) => source.session)).toEqual(['c8fdf4bc-0000-4000-8000-000000000001'])
    expect(sources[0]!.key(false)).toMatch(/^copilot:\d+:/)
    expect(await sources[0]!.read(false)).toEqual([
      { startUuid: 'e1', start: 'prompt', startedAt: at(1), endedAt: at(5), replies: 1, askSeconds: 0, limited: false, cliSeconds: null },
    ])
  })
})
