import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { costRows, DEFAULT_LLM_MODEL, excerptOf, llmSettings, parseChatResponse, parseVerdict } from './classify.js'
import type { TranscriptEntry } from './stream.js'

const repo = resolve(import.meta.dirname, '..', '..').replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, '')
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

describe('parseChatResponse', () => {
  const body = {
    id: 'chatcmpl-1',
    model: 'gemini/gemini-3.7-flash',
    choices: [{ index: 0, message: { role: 'assistant', content: '{"reason":"normal","note":"Ок"}' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940, prompt_tokens_details: { cached_tokens: 300 } },
  }

  it('reads the answer, the call id and the usage of the model that answered', () => {
    expect(parseChatResponse(body)).toEqual({
      result: '{"reason":"normal","note":"Ок"}',
      sessionId: 'chatcmpl-1',
      usage: [{ model: 'gemini-3.7-flash', input: 600, output: 40, cacheRead: 300, cacheWrite: 0 }],
    })
  })

  it('counts a missing usage as zero tokens', () => {
    const { usage: _, ...bare } = body
    expect(parseChatResponse({ ...bare, model: 'gemini-3.8-flash' }).usage).toEqual([
      { model: 'gemini-3.8-flash', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ])
  })

  it('fails on an error body or an empty answer', () => {
    expect(() => parseChatResponse({ error: { message: 'No deployments available' } })).toThrow(/No deployments available/)
    expect(() => parseChatResponse({ ...body, choices: [{ message: { content: null } }] })).toThrow(/no answer/)
  })
})

describe('llmSettings', () => {
  it('needs the URL and the key, the model has a default', () => {
    expect(llmSettings({ TALLY_LLM_URL: 'http://100.64.0.1:4000/', TALLY_LLM_KEY: 'sk-x' })).toEqual({
      url: 'http://100.64.0.1:4000',
      key: 'sk-x',
      model: DEFAULT_LLM_MODEL,
    })
    expect(llmSettings({ TALLY_LLM_URL: 'http://h:4000', TALLY_LLM_KEY: 'sk-x', TALLY_LLM_MODEL: 'm' })?.model).toBe('m')
    expect(llmSettings({ TALLY_LLM_URL: 'http://h:4000' })).toBeUndefined()
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
        project: basename(repo),
        projectDir: repo,
        task: null,
        branch: null,
        entrypoint: 'tally-classify',
        model: 'claude-haiku-4-5-20251001',
        speed: null,
        effort: null,
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
