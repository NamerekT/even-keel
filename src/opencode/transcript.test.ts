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
