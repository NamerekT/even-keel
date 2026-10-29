import { describe, expect, it } from 'vitest'
import { foldSession, type MessageRow, type PartRow } from './transcript.js'

const T0 = Date.parse('2026-10-22T10:00:00.000Z')
const CWD = '/work/demo'

function message(id: string, offset: number, data: Record<string, unknown>): MessageRow {
  return { id, at: T0 + offset * 1000, data: JSON.stringify(data) }
}

function part(id: string, owner: string, offset: number, data: Record<string, unknown>): PartRow {
  return { id, message: owner, at: T0 + offset * 1000, data: JSON.stringify(data) }
}

function step(tokens: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { role: 'assistant', path: { cwd: CWD, root: CWD }, providerID: 'opencode', modelID: 'big-pickle', tokens, ...extra }
}

const prompt = message('msg_01', 0, { role: 'user', model: { providerID: 'opencode', modelID: 'big-pickle' } })
const promptText = part('prt_01', 'msg_01', 0, { type: 'text', text: 'DEMO-1' })

describe('foldSession', () => {
  it('classifies a ChatGPT model refusal in stored steps and terminal errors', () => {
    const error = { name: 'APIError', data: { message: 'Request failed', responseBody: JSON.stringify({ error: { message: "The 'denied' model is not supported when using Codex with a ChatGPT account." } }) } }
    const row = message('msg_02', 2, step({}, { providerID: 'openai', modelID: 'denied', error }))
    expect(foldSession([prompt, row], [promptText]).apiError).toMatchObject({ kind: 'model', notice: { code: 'chain.modelUnavailable', params: { model: 'openai/denied' } } })
    expect(foldSession([prompt], [promptText], 30, false, [{ at: T0 + 2000, error }]).apiError).toMatchObject({ kind: 'model' })
  })

  it('adds tool result pictures to the whole transcript without exposing their data', () => {
    const rows = [message('msg_02', 2, step({ input: 10 }))]
    const projected = [{ ...part('prt_02', 'msg_02', 2, {
      type: 'tool', tool: 'read', callID: 'c1',
      state: { status: 'completed', input: { filePath: `${CWD}/.temp/inbox/shot.png` } },
    }), images: 1 }]
    const whole = foldSession(rows, projected, Infinity, true)
    expect(whole.feed).toEqual([
      expect.objectContaining({ kind: 'tool', tool: 'c1' }),
      expect.objectContaining({ kind: 'image', tool: 'c1', images: 1, text: `${CWD}/.temp/inbox/shot.png` }),
    ])
    expect(whole.action?.kind).toBe('tool')
    expect(foldSession(rows, projected).feed.some((line) => line.kind === 'image')).toBe(false)
    const browser = [{ ...projected[0]!, data: JSON.stringify({ type: 'tool', tool: 'browser_screenshot', callID: 'c2', state: { status: 'completed' } }), images: 2 }]
    expect(foldSession(rows, browser, Infinity, true).feed[1]).toMatchObject({ kind: 'image', tool: 'c2', images: 2, text: '' })
  })

  it('starts the turn at the prompt and takes the model, the folder and the context of the last step', () => {
    const summary = foldSession(
      [
        prompt,
        message('msg_02', 2, step({ input: 1000, output: 50, reasoning: 10, cache: { read: 9000, write: 500 } })),
        message('msg_03', 4, step({ input: 200, output: 30, reasoning: 0, cache: { read: 10_000, write: 0 } })),
      ],
      [promptText],
    )
    expect(summary.turn).toEqual({ startedAt: '2026-10-22T10:00:00.000Z', tool: null })
    expect(summary.model).toBe('opencode/big-pickle')
    expect(summary.workdir).toBe(CWD)
    expect(summary.contextTokens).toBe(10_200)
    expect(summary.tokens).toEqual({ input: 1200, output: 90, cacheRead: 19_000, cacheWrite: 500 })
    expect(summary.feed[0]).toMatchObject({ kind: 'prompt', text: 'DEMO-1' })
  })

  it("names OpenCode's tools as Claude Code does and moves the stage by them", () => {
    const summary = foldSession(
      [prompt, message('msg_02', 2, step({ input: 10 })), message('msg_03', 4, step({ input: 10 }))],
      [
        promptText,
        part('prt_02', 'msg_02', 2, { type: 'tool', tool: 'read', callID: 'c1', state: { status: 'completed', input: { filePath: `${CWD}/src/app.ts` } } }),
        part('prt_03', 'msg_02', 3, {
          type: 'tool',
          tool: 'edit',
          callID: 'c2',
          state: { status: 'completed', input: { filePath: `${CWD}/src/app.ts`, oldString: 'a', newString: 'b' } },
        }),
        part('prt_04', 'msg_03', 4, { type: 'tool', tool: 'bash', callID: 'c3', state: { status: 'running', input: { command: 'git commit -m "x"' } } }),
      ],
    )
    expect(summary.feed.filter((line) => line.kind === 'tool').map((line) => line.text.split(' ')[0])).toEqual(['Read', 'Edit', 'Shell'])
    expect(summary.stage).toBe('commit')
    expect(summary.turn?.tool).toBe(summary.action?.text)
  })

  it('reads the checkpoint, the pull request and NO CHANGES from the last text', () => {
    const summary = foldSession(
      [prompt, message('msg_02', 2, step({ input: 10 }, { finish: 'stop' }))],
      [promptText, part('prt_02', 'msg_02', 2, { type: 'text', text: 'Nothing to do.\nNO CHANGES: already in dev' })],
    )
    expect(summary.lastMessage).toBe('Nothing to do.\nNO CHANGES: already in dev')
    expect(summary.noChanges).toBe('already in dev')
    expect(summary.checkpoint).toBeNull()
  })

  it("tells a provider's limit from another error, unwrapping the JSON answer", () => {
    const limit = JSON.stringify({ error: { message: 'Rate limit reached for requests' } })
    const summary = foldSession(
      [prompt, message('msg_02', 2, step({ input: 10 }, { error: { name: 'APIError', data: { message: limit } } }))],
      [promptText],
    )
    expect(summary.apiError).toMatchObject({ kind: 'limit', text: 'Rate limit reached for requests' })
    const other = foldSession([prompt, message('msg_02', 2, step({ input: 10 }, { error: { name: 'UnknownError', data: {} } }))], [promptText])
    expect(other.apiError).toMatchObject({ kind: 'error', text: 'UnknownError' })
  })

  it("takes OpenCode Zen's 429 for a limit by its status or its error type, whatever the message says", () => {
    const zen = JSON.stringify({ type: 'error', error: { type: 'FreeUsageLimitError', message: 'Try again later.' } })
    const typed = foldSession([prompt, message('msg_02', 2, step({ input: 10 }, { error: { name: 'APIError', data: { message: zen } } }))], [promptText])
    expect(typed.apiError).toMatchObject({ kind: 'limit', text: 'Try again later.' })
    const status = { name: 'APIError', data: { message: 'Something went wrong.', statusCode: 429 } }
    const coded = foldSession([prompt], [promptText], 30, false, [{ at: T0 + 2000, error: status }])
    expect(coded.apiError).toMatchObject({ kind: 'limit', text: 'Something went wrong.' })
    const quota = { name: 'APIError', data: { message: 'You exceeded your current quota.', statusCode: 429 } }
    expect(foldSession([prompt], [promptText], 30, false, [{ at: T0 + 2000, error: quota }]).apiError).toMatchObject({ kind: 'credit' })
  })

  it.each([
    ['the provider response', 'You have no credits remaining. Add credits to continue.', { type: 'insufficient_quota', code: 'credit_balance_exhausted' }],
    ['the message alone', 'You have no credits remaining. Add credits to continue.', undefined],
    ['the quota type in the response body', 'Something went wrong.', { type: 'insufficient_quota' }],
    ['the balance code before a transient message', 'Service unavailable.', { code: 'credit_balance_exhausted' }],
  ])('recognizes exhausted credits from %s before retryable HTTP 429', (_source, text, body) => {
    const error = {
      name: 'APIError',
      data: { message: text, statusCode: 429, isRetryable: true, responseBody: JSON.stringify({ error: body }) },
    }
    const stored = foldSession([prompt, message('msg_02', 2, step({ input: 10 }, { error }))], [promptText])
    const terminal = foldSession([prompt], [promptText], 30, false, [{ at: T0 + 2000, error }])
    for (const summary of [stored, terminal]) {
      expect(summary.apiError).toMatchObject({ kind: 'credit', text })
      expect(summary.feed.at(-1)).toMatchObject({ kind: 'error', text })
    }
  })

  it.each([
    ['the message', 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.', undefined],
    ['the response body', 'Request failed.', 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.'],
    ['the response body before a transient message', 'Service unavailable.', 'You have reached your specified API usage limits.'],
  ])('recognizes a spending cap from %s in stored steps and terminal errors', (_source, text, body) => {
    const error = {
      name: 'APIError',
      data: { message: text, statusCode: 400, isRetryable: false, responseBody: JSON.stringify({ error: { message: body } }) },
    }
    const stored = foldSession([prompt, message('msg_02', 2, step({}, { error }))], [promptText])
    const terminal = foldSession([prompt], [promptText], 30, false, [{ at: T0 + 2000, error }])
    for (const summary of [stored, terminal]) {
      expect(summary.apiError).toMatchObject({ kind: 'spend', text })
      expect(summary.feed.at(-1)).toMatchObject({ kind: 'error', text })
    }
  })

  it('shows an error a turn ended on in its place, and once when a step holds it too', () => {
    const unknown = { name: 'UnknownError', data: { message: 'Unexpected server error. Check server logs for details.' } }
    const again = message('msg_03', 10, { role: 'user' })
    const summary = foldSession([prompt, again], [promptText, part('prt_03', 'msg_03', 10, { type: 'text', text: 'try again' })], 30, false, [
      { at: T0 + 2000, error: unknown },
    ])
    expect(summary.feed.map((line) => [line.kind, line.text])).toEqual([
      ['prompt', 'DEMO-1'],
      ['error', 'Unexpected server error. Check server logs for details.'],
      ['prompt', 'try again'],
    ])
    expect(summary.apiError).toBeNull()

    const failed = foldSession([prompt], [promptText], 30, false, [{ at: T0 + 2000, error: unknown }])
    expect(failed.apiError).toMatchObject({ kind: 'error', text: 'Unexpected server error. Check server logs for details.' })
    expect(failed.lastActivityAt).toBe('2026-10-22T10:00:02.000Z')

    const limit = { name: 'APIError', data: { message: 'Rate limit reached' } }
    const both = foldSession([prompt, message('msg_02', 2, step({ input: 10 }, { error: limit }))], [promptText], 30, false, [{ at: T0 + 3000, error: limit }])
    expect(both.feed.filter((line) => line.kind === 'error')).toHaveLength(1)
  })

  it('skips the synthetic texts OpenCode adds and rows it cannot parse', () => {
    const summary = foldSession(
      [prompt, { id: 'msg_bad', at: T0 + 1000, data: '{' }, message('msg_02', 2, step({ input: 10 }))],
      [promptText, part('prt_02', 'msg_02', 2, { type: 'text', text: 'injected', synthetic: true }), { id: 'prt_bad', message: 'msg_02', at: T0, data: 'x' }],
    )
    expect(summary.lastMessage).toBeNull()
    expect(summary.feed).toHaveLength(1)
  })

  it('keeps the edit size and the failed call in the whole feed only', () => {
    const rows = [prompt, message('msg_02', 2, step({ input: 10 }))]
    const parts = [
      promptText,
      part('prt_02', 'msg_02', 2, {
        type: 'tool',
        tool: 'write',
        callID: 'c1',
        state: { status: 'error', input: { filePath: `${CWD}/a.txt`, content: 'one\ntwo\n' }, error: 'File is outside the project' },
      }),
    ]
    expect(foldSession(rows, parts).feed.some((line) => line.kind === 'failed')).toBe(false)
    const whole = foldSession(rows, parts, 100, true)
    expect(whole.feed.find((line) => line.kind === 'failed')).toMatchObject({ tool: 'c1' })
    expect(whole.feed.find((line) => line.kind === 'tool')).toMatchObject({ tool: 'c1' })
  })

  it("shows the chat's message the plugin put after a tool's output as the user's, once, and no mark a tool printed", () => {
    const mark = '<even-keel-message id="7">\nAlso check the docs.\n</even-keel-message>'
    const tool = (id: string, callID: string, metadata: Record<string, unknown>) =>
      part(id, 'msg_02', 2, { type: 'tool', tool: 'bash', callID, state: { status: 'completed', input: { command: 'cat notes.md' }, output: `done\n\n${mark}`, metadata } })
    const summary = foldSession(
      [prompt, message('msg_02', 2, step({ input: 10 }))],
      [promptText, tool('prt_02', 'c1', { exit: 0 }), tool('prt_03', 'c2', { exit: 0, evenKeel: { mail: `The user wrote to you.\n\n${mark}` } }), tool('prt_04', 'c3', { evenKeel: { mail: mark } })],
    )
    expect(summary.feed.map((line) => line.kind)).toEqual(['prompt', 'tool', 'tool', 'prompt', 'tool'])
    expect(summary.feed[3]).toMatchObject({ kind: 'prompt', text: 'Also check the docs.' })
    expect(summary.turn?.startedAt).toBe('2026-10-22T10:00:00.000Z')
  })
})
