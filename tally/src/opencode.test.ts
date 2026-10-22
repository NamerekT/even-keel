import { describe, expect, it } from 'vitest'
import type { ResponseRow } from '../../src/opencode/db.js'
import { openCodeBatch } from './opencode.js'

const T0 = Date.parse('2026-10-22T10:00:00.000Z')
const CWD = '/work/demo/.claude/worktrees/demo-7'

function response(id: string, offset: number, tokens: Record<string, unknown> | undefined, patch: Partial<ResponseRow> = {}): ResponseRow {
  const data = { role: 'assistant', path: { cwd: CWD, root: CWD }, providerID: 'anthropic', modelID: 'claude-sonnet-4-5', tokens }
  return { id, session: 'ses_root', parent: null, title: 'DEMO-7', at: T0 + offset * 1000, data: JSON.stringify(data), ...patch }
}

describe('openCodeBatch', () => {
  const launches = new Map([['ses_root', { task: 'DEMO-7', reason: 'launch' }]])

  it("counts each response's tokens, reasoning as output, under the session Even Keel launched", () => {
    const batch = openCodeBatch([response('msg_1', 0, { input: 100, output: 20, reasoning: 5, cache: { read: 9000, write: 300 } })], { account: 'zen', launches })
    expect([...batch.messages.values()]).toEqual([
      {
        messageId: 'opencode:msg_1',
        sessionId: 'ses_root',
        agentId: null,
        account: 'zen',
        project: 'demo',
        projectDir: '/work/demo',
        task: 'DEMO-7',
        branch: null,
        entrypoint: 'opencode',
        model: 'claude-sonnet-4-5',
        speed: null,
        effort: null,
        at: '2026-10-22T10:00:00.000Z',
        input: 100,
        cacheWrite5m: 300,
        cacheWrite1h: 0,
        cacheRead: 9000,
        output: 25,
      },
    ])
    expect(batch.sessions.get('ses_root')).toMatchObject({ aiTitle: 'DEMO-7', launchTask: 'DEMO-7', launchReason: 'launch', project: 'demo' })
  })

  it("puts a subagent's responses into its parent's session and spans the session over all of them", () => {
    const batch = openCodeBatch(
      [
        response('msg_2', 60, { input: 10, output: 1 }, { session: 'ses_child', parent: 'ses_root', title: 'explore' }),
        response('msg_1', 0, { input: 10, output: 1 }),
      ],
      { account: 'zen', launches },
    )
    expect(batch.messages.get('opencode:msg_2')).toMatchObject({ sessionId: 'ses_root', agentId: 'ses_child', task: 'DEMO-7' })
    expect([...batch.sessions.keys()]).toEqual(['ses_root'])
    expect(batch.sessions.get('ses_root')).toMatchObject({ aiTitle: 'DEMO-7', firstAt: '2026-10-22T10:00:00.000Z', lastAt: '2026-10-22T10:01:00.000Z' })
  })

  it('skips a response without tokens yet and a row it cannot parse', () => {
    const batch = openCodeBatch(
      [response('msg_1', 0, { input: 0, output: 0, cache: { read: 0, write: 0 } }), response('msg_2', 1, undefined), { ...response('msg_3', 2, {}), data: '{' }],
      { account: 'zen', launches: new Map() },
    )
    expect(batch.messages.size).toBe(0)
    expect(batch.sessions.size).toBe(0)
  })

  it('takes the task from the worktree when Even Keel did not launch the session', () => {
    const batch = openCodeBatch([response('msg_1', 0, { input: 10 })], { account: 'zen', launches: new Map() })
    expect(batch.messages.get('opencode:msg_1')?.task).toBe('DEMO-7')
  })
})
