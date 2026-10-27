import { describe, expect, it } from 'vitest'
import { PROMPTS } from '../../src/chain/prompts.js'
import { RolloutTurnBuilder } from './rollout-turns.js'

const at = (seconds: number) => new Date(Date.parse('2026-10-01T10:00:00Z') + seconds * 1000).toISOString()
const line = (seconds: number, type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp: at(seconds), type, payload })
const event = (seconds: number, type: string, rest: Record<string, unknown> = {}) => line(seconds, 'event_msg', { type, ...rest })
const response = (seconds: number, id: string, total: number) => line(seconds, 'token_usage_record', {
  response_id: id, usage: { input_tokens: 10, output_tokens: 1 }, thread_token_usage: { total_tokens: total },
})
const count = (seconds: number, total: number) => event(seconds, 'token_count', {
  info: { last_token_usage: { input_tokens: 10, output_tokens: 1 }, total_token_usage: { total_tokens: total } },
})
const item = (seconds: number, payload: Record<string, unknown>) => line(seconds, 'response_item', payload)

function turns(lines: string[], launched = false) {
  const builder = new RolloutTurnBuilder(launched)
  for (const text of lines) builder.push(text)
  return builder.finish()
}

describe('Codex turns', () => {
  it('uses turn boundaries, counts API replies once, and leaves CLI duration unknown', () => {
    expect(turns([
      event(0, 'task_started', { turn_id: 't1' }),
      line(1, 'turn_context', { turn_id: 't1', model: 'gpt-6.1-terra' }),
      response(20, 'r1', 11), count(21, 11), count(22, 11),
      response(30, 'r2', 22), count(31, 22),
      event(40, 'task_complete', { turn_id: 't1', duration_ms: 40000 }),
      item(90, { type: 'custom_tool_call_output', call_id: 'late', output: 'killed' }),
      event(100, 'task_started', { turn_id: 't2' }),
      count(105, 22), count(110, 33), count(111, 33),
      event(120, 'task_complete', { turn_id: 't2' }),
    ], true)).toEqual([
      { startUuid: 't1', start: 'launch', startedAt: at(0), endedAt: at(40), replies: 2, askSeconds: 0, limited: false, cliSeconds: null },
      { startUuid: 't2', start: 'prompt', startedAt: at(100), endedAt: at(120), replies: 1, askSeconds: 0, limited: false, cliSeconds: null },
    ])
  })

  it('subtracts visible synchronous question waits and keeps async questions active', () => {
    const [turn] = turns([
      event(0, 'task_started', { turn_id: 't1' }), response(5, 'r1', 11),
      item(10, { type: 'function_call', name: 'functions.request_user_input', call_id: 'ask1' }),
      item(15, { type: 'function_call', name: 'request_user_input', call_id: 'ask2' }),
      item(30, { type: 'function_call_output', call_id: 'ask1', output: '{}' }),
      item(40, { type: 'function_call_output', call_id: 'ask2', output: '{}' }),
      item(45, { type: 'function_call', name: 'request_user_input_async', call_id: 'async' }),
      item(46, { type: 'function_call_output', call_id: 'async', output: '{}' }),
      event(60, 'task_complete', { turn_id: 't1' }),
    ])
    expect(turn).toMatchObject({ askSeconds: 30, endedAt: at(60) })
  })

  it('bounds an unanswered question at the last activity and an aborted turn at the abort', () => {
    const result = turns([
      event(0, 'task_started', { turn_id: 't1' }), response(5, 'r1', 11),
      item(10, { type: 'function_call', name: 'request_user_input', call_id: 'ask' }),
      event(30, 'turn_aborted', { turn_id: 't1' }),
      item(80, { type: 'function_call_output', call_id: 'ask' }),
      event(100, 'task_started', { turn_id: 't2' }), response(110, 'r2', 22),
      item(130, { type: 'custom_tool_call_output', call_id: 'build', output: 'done' }),
      event(180, 'token_count', { info: null }),
    ])
    expect(result.map((t) => [t.endedAt, t.askSeconds])).toEqual([[at(30), 20], [at(130), 0]])
  })

  it('recognizes limits and resume prompts without splitting on steering or compaction', () => {
    const result = turns([
      event(0, 'task_started', { turn_id: 't1' }), response(10, 'r1', 11),
      event(20, 'error', { message: "You've hit your usage limit." }),
      event(20, 'task_complete', { turn_id: 't1', error: { codex_error_info: 'UsageLimitReached' } }),
      event(100, 'task_started', { turn_id: 't2' }),
      event(101, 'user_message', { message: PROMPTS.en.resume + 'continue' }),
      response(110, 'r2', 22), event(115, 'user_message', { message: 'also check the tests' }),
      line(120, 'compacted', { message: 'summary' }),
      line(121, 'turn_context', { turn_id: 't2' }),
      event(130, 'task_complete', { turn_id: 't2' }),
    ])
    expect(result.map((t) => [t.start, t.limited, t.endedAt])).toEqual([
      ['prompt', true, at(20)], ['resume', false, at(130)],
    ])
  })

  it('falls back to context and assistant items when older rollouts lack boundaries or usage', () => {
    const result = turns([
      '', 'bad json', line(0, 'session_meta', {}),
      item(1, { type: 'message', role: 'developer', content: [] }),
      line(5, 'turn_context', { turn_id: 'old' }),
      item(15, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] }),
      event(16, 'item_completed', { item: { type: 'AgentMessage', id: 'm1', content: [] } }),
    ])
    expect(result).toEqual([expect.objectContaining({ startUuid: 'old', startedAt: at(5), endedAt: at(16), replies: 1 })])
  })

  it('accepts older boundaries without turn IDs and ignores completions of a different known turn', () => {
    const result = turns([
      event(0, 'task_started'),
      event(10, 'agent_message', { message: 'Done' }),
      event(20, 'task_complete', { turn_id: 'old' }),
      event(30, 'task_started', { turn_id: 'next' }), response(35, 'r1', 11),
      event(90, 'task_complete', { turn_id: 'old' }),
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ endedAt: at(20), replies: 1 })
    expect(result[1]).toMatchObject({ endedAt: at(35), replies: 1 })
  })
})
