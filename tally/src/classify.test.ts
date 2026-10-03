import { describe, expect, it } from 'vitest'
import { costRows, excerptOf, parseCliOutput, parseVerdict } from './classify.js'
import type { TranscriptEntry } from './stream.js'

let n = 0
const at = (second: number) => `2026-10-03T10:00:${String(second).padStart(2, '0')}.000Z`

function user(second: number, content: unknown, agentId?: string): TranscriptEntry {
  return { type: 'user', uuid: `u${++n}`, timestamp: at(second), agentId, message: { role: 'user', content } } as TranscriptEntry
}

function assistant(second: number, content: unknown[], agentId?: string): TranscriptEntry {
  return { type: 'assistant', uuid: `u${++n}`, timestamp: at(second), agentId, message: { id: `m${n}`, content } } as TranscriptEntry
}

const bash = (id: string, command: string) => ({ type: 'tool_use', id, name: 'Bash', input: { command } })
const result = (id: string, text: string, isError = false) => ({ type: 'tool_result', tool_use_id: id, is_error: isError, content: text })

describe('excerptOf', () => {
  const entries = [
    user(1, 'Fix the failing build'),
    assistant(2, [{ type: 'text', text: 'Looking.' }]),
    user(3, 'Also check the docs'),
    assistant(10, [bash('t1', 'npm test')]),
    user(11, [result('t1', 'Exit code 1\nFAIL a.test.ts', true)]),
    assistant(12, [bash('t2', 'npm test')]),
    user(13, [result('t2', 'ok')]),
    assistant(14, [bash('t3', 'npm run lint')], 'agent1'),
    assistant(30, [{ type: 'text', text: 'After the span.' }]),
  ]

  it('takes the stream events inside the span after the last prompt before it', () => {
    expect(excerptOf(entries, { agentId: null, fromAt: at(10), toAt: at(13) })).toBe(
      [
        '10:00:03 user: Also check the docs',
        '10:00:10 Bash: npm test → error: Exit code 1 FAIL a.test.ts',
        '10:00:12 Bash: npm test → ok',
      ].join('\n'),
    )
  })

  it('keeps the head and the tail of a long span', () => {
    const many: TranscriptEntry[] = []
    for (let i = 0; i < 150; i++) many.push(assistant(20, [{ type: 'text', text: `step ${i}` }]))
    const lines = excerptOf(many, { agentId: null, fromAt: at(20), toAt: at(20) }).split('\n')
    expect(lines).toHaveLength(121)
    expect(lines[39]).toBe('10:00:20 assistant: step 39')
    expect(lines[40]).toBe('… 30 events skipped …')
    expect(lines[41]).toBe('10:00:20 assistant: step 70')
  })
})

describe('parseVerdict', () => {
  it('reads the JSON answer, fenced or not', () => {
    expect(parseVerdict('{"reason":"debug_loop","note":"Гонял тесты"}')).toEqual({ reason: 'debug_loop', note: 'Гонял тесты' })
    expect(parseVerdict('```json\n{"reason": "normal", "note": "Ок"}\n```')).toEqual({ reason: 'normal', note: 'Ок' })
  })

  it('rejects an unknown reason or a non-JSON answer', () => {
    expect(() => parseVerdict('{"reason":"lazy","note":"x"}')).toThrow(/lazy/)
    expect(() => parseVerdict('I think it was a debug loop')).toThrow()
  })
})

describe('parseCliOutput', () => {
  const output = JSON.stringify({
    type: 'result',
    is_error: false,
    result: '{"reason":"normal","note":"Ок"}',
    session_id: 'c1',
    modelUsage: {
      'claude-haiku-4-5-20251001': { inputTokens: 900, outputTokens: 40, cacheReadInputTokens: 0, cacheCreationInputTokens: 300, costUSD: 0.002 },
    },
  })

  it('reads the answer, the session and the usage per model', () => {
    expect(parseCliOutput(output)).toEqual({
      result: '{"reason":"normal","note":"Ок"}',
      sessionId: 'c1',
      usage: [{ model: 'claude-haiku-4-5-20251001', input: 900, output: 40, cacheRead: 0, cacheWrite: 300 }],
    })
  })

  it('fails on an error result', () => {
    expect(() => parseCliOutput(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in', session_id: 'c1' }))).toThrow(/Not logged in/)
  })
})

describe('costRows', () => {
  it('prices the classifier like any other answer, cache write as 5 minutes', () => {
    const usage = [{ model: 'claude-haiku-4-5-20251001', input: 900, output: 40, cacheRead: 5, cacheWrite: 300 }]
    expect(costRows('c1', usage, 'global', '2026-10-03T12:00:00.000Z')).toEqual([
      {
        messageId: 'tally-classify:c1:claude-haiku-4-5-20251001',
        sessionId: 'c1',
        agentId: null,
        account: 'global',
        project: 'tally',
        projectDir: null,
        task: null,
        branch: null,
        entrypoint: 'tally-classify',
        model: 'claude-haiku-4-5-20251001',
        speed: null,
        at: '2026-10-03T12:00:00.000Z',
        input: 900,
        cacheWrite5m: 300,
        cacheWrite1h: 0,
        cacheRead: 5,
        output: 40,
      },
    ])
  })
})
