import { describe, expect, it } from 'vitest'
import { launchMap } from './parse.js'
import { RolloutBuilder, rolloutSession } from './rollout.js'

const SESSION = '01a14a11-16af-7a80-acdb-6fb33607c527'
const CWD = 'D:\\Projects\\EvenKeel\\.claude\\worktrees\\btn-46'

const line = (timestamp: string, type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp, type, payload })
const meta = (originator = 'codex_exec') =>
  line('2026-10-17T13:33:16.710Z', 'session_meta', { id: SESSION, cwd: CWD, originator, git: { branch: 'btn-46/task' } })
const context = (at: string, model: string, effort = 'high') => line(at, 'turn_context', { cwd: CWD, model, effort })
const usage = (input: number, cached: number, output: number, write = 0) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  cache_write_input_tokens: write,
  output_tokens: output,
  reasoning_output_tokens: 1,
  total_tokens: input + output,
})
const record = (at: string, response: string, last: ReturnType<typeof usage>, thread: ReturnType<typeof usage>) =>
  line(at, 'token_usage_record', { session_id: SESSION, response_id: response, usage: last, thread_token_usage: thread })
const count = (at: string, last: ReturnType<typeof usage>, total: ReturnType<typeof usage>) =>
  line(at, 'event_msg', { type: 'token_count', info: { last_token_usage: last, total_token_usage: total, model_context_window: 258400 } })

function build(lines: string[], launches = launchMap([])) {
  const builder = new RolloutBuilder({ account: 'codex', launches }, SESSION)
  for (const text of lines) builder.push(text)
  return builder.finish()
}

describe('rolloutSession', () => {
  it('takes the session id from a plain or compressed rollout name', () => {
    expect(rolloutSession(`C:\\u\\.codex\\sessions\\2026\\10\\17\\rollout-2026-10-17T15-33-16-${SESSION}.jsonl`)).toBe(SESSION)
    expect(rolloutSession(`/u/.codex/sessions/2026/08/16/rollout-2026-08-16T22-38-38-${SESSION}.jsonl.zst`)).toBe(SESSION)
    expect(rolloutSession('/u/.codex/session_index.jsonl')).toBeNull()
  })
})

describe('RolloutBuilder', () => {
  it('makes a response of each token_usage_record, with the model and effort of its turn', () => {
    const batch = build([
      meta(),
      context('2026-10-17T13:33:18.000Z', 'gpt-5.6-luna'),
      record('2026-10-17T13:34:34.201Z', 'resp_1', usage(13398, 0, 9827), usage(13398, 0, 9827)),
      count('2026-10-17T13:34:34.216Z', usage(13398, 0, 9827), usage(13398, 0, 9827)),
      context('2026-10-17T13:34:59.000Z', 'gpt-5.6-terra', 'xhigh'),
      record('2026-10-17T13:35:00.531Z', 'resp_2', usage(25531, 13184, 19, 100), usage(38929, 13184, 9846, 100)),
      count('2026-10-17T13:35:00.545Z', usage(25531, 13184, 19, 100), usage(38929, 13184, 9846, 100)),
    ])
    expect([...batch.messages.values()]).toEqual([
      {
        messageId: 'resp_1', sessionId: SESSION, agentId: null, account: 'codex', project: 'EvenKeel', projectDir: 'D:\\Projects\\EvenKeel',
        task: 'BTN-46', branch: 'btn-46/task', entrypoint: 'codex-exec', model: 'gpt-5.6-luna', speed: null, effort: 'high',
        at: '2026-10-17T13:34:34.201Z', input: 13398, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 9827,
      },
      expect.objectContaining({ messageId: 'resp_2', model: 'gpt-5.6-terra', effort: 'xhigh', input: 25531 - 13184 - 100, cacheRead: 13184, cacheWrite5m: 100, output: 19 }),
    ])
    expect(batch.lines.size).toBe(0)
  })

  it('falls back to token_count where the CLI wrote no token_usage_record, once per total', () => {
    const batch = build([
      meta('Codex Desktop'),
      context('2026-08-16T20:00:00.000Z', 'gpt-5.6-terra'),
      count('2026-08-16T20:00:01.000Z', usage(0, 0, 0), usage(0, 0, 0)),
      count('2026-08-16T20:00:05.000Z', usage(1000, 200, 50), usage(1000, 200, 50)),
      count('2026-08-16T20:00:06.000Z', usage(1000, 200, 50), usage(1000, 200, 50)),
      record('2026-08-16T20:01:00.000Z', 'resp_9', usage(500, 0, 10), usage(1500, 200, 60)),
      count('2026-08-16T20:01:00.100Z', usage(500, 0, 10), usage(1500, 200, 60)),
    ])
    expect([...batch.messages.values()].map((row) => [row.messageId, row.input, row.cacheRead, row.output, row.entrypoint, row.at])).toEqual([
      ['resp_9', 500, 0, 10, 'codex-desktop', '2026-08-16T20:01:00.000Z'],
      [`codex:${SESSION}:1050`, 800, 200, 50, 'codex-desktop', '2026-08-16T20:00:05.000Z'],
    ])
  })

  it('counts no token_count after the first record, even once a turn stopped between a record and its token_count shifted the totals', () => {
    const batch = build([
      meta(),
      context('2026-10-29T10:00:00.000Z', 'gpt-6.1-sol'),
      record('2026-10-29T10:00:10.000Z', 'resp_1', usage(1000, 0, 100), usage(1000, 0, 100)),
      count('2026-10-29T10:00:10.010Z', usage(1000, 0, 100), usage(1000, 0, 100)),
      record('2026-10-29T10:00:20.000Z', 'resp_2', usage(2000, 1000, 200), usage(3000, 1000, 300)),
      context('2026-10-29T10:05:00.000Z', 'gpt-6.1-sol'),
      record('2026-10-29T10:05:10.000Z', 'resp_3', usage(3000, 2000, 300), usage(6000, 3000, 600)),
      count('2026-10-29T10:05:10.010Z', usage(3000, 2000, 300), usage(4000, 2000, 400)),
      record('2026-10-29T10:05:20.000Z', 'resp_4', usage(4000, 3000, 400), usage(10000, 6000, 1000)),
      count('2026-10-29T10:05:20.010Z', usage(4000, 3000, 400), usage(8000, 5000, 800)),
    ])
    expect([...batch.messages.keys()]).toEqual(['resp_1', 'resp_2', 'resp_3', 'resp_4'])
  })

  it('writes the session with its launch and span, and none for a rollout without a single response', () => {
    const launches = launchMap([{ at: '2026-10-17T13:33:00.000Z', task: 'BTN-46', sessionId: SESSION, reason: 'relay' }] as never)
    const batch = build([meta(), context('2026-10-17T13:33:18.000Z', 'gpt-5.6-luna'), record('2026-10-17T13:34:34.201Z', 'resp_1', usage(10, 0, 5), usage(10, 0, 5))], launches)
    expect(batch.sessions.get(SESSION)).toEqual({
      sessionId: SESSION, account: 'codex', project: 'EvenKeel', customTitle: null, aiTitle: null,
      launchTask: 'BTN-46', launchReason: 'relay', firstAt: '2026-10-17T13:33:16.710Z', lastAt: '2026-10-17T13:34:34.201Z',
    })
    expect(build([meta('Codex Desktop'), count('2026-10-12T05:26:14.523Z', usage(0, 0, 0), usage(0, 0, 0))]).sessions.size).toBe(0)
  })

  it('skips lines that are not JSON', () => {
    expect(build(['', 'not json', meta()]).messages.size).toBe(0)
  })
})
