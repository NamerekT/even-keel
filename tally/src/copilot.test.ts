import { describe, expect, it } from 'vitest'
import { copilotSession, CopilotBuilder } from './copilot.js'

const SESSION = '11111111-2222-4333-8444-555555555555'
const CWD = '/work/demo/.claude/worktrees/demo-7'

const event = (type: string, data: Record<string, unknown>, at: string, patch: Record<string, unknown> = {}) =>
  JSON.stringify({ type, data, id: `${type}-${at}`, timestamp: `2026-10-22T10:${at}.000Z`, parentId: null, ...patch })

const usage = (tokens: Record<string, number>, model = 'gpt-6-luna') => ({ usage: { model, maxPromptTokens: 272000, ...tokens } })

function batchOf(lines: string[], launches = new Map([[SESSION, { task: 'DEMO-7', reason: 'launch' }]])) {
  const builder = new CopilotBuilder({ account: 'github', launches }, SESSION)
  for (const line of lines) builder.push(line)
  return builder.finish()
}

describe('copilotSession', () => {
  it('takes the session id from the folder of an events file', () => {
    expect(copilotSession(`/home/demo/.copilot/session-state/${SESSION}/events.jsonl`)).toBe(SESSION)
    expect(copilotSession(`C:\\copilot\\session-state\\${SESSION}\\events.jsonl`)).toBe(SESSION)
    expect(copilotSession(`/home/demo/.copilot/session-state/${SESSION}/workspace.yaml`)).toBeNull()
  })
})

describe('CopilotBuilder', () => {
  it('counts each model call, the cache taken out of the prompt and the reasoning in the output, under the launched session', () => {
    const batch = batchOf([
      event('session.start', { sessionId: SESSION, context: { cwd: CWD, branch: 'demo-7/task' } }, '00:00'),
      event('session.usage_record', usage({ inputTokens: 14311, outputTokens: 29, cacheReadTokens: 0, cacheWriteTokens: 14308, reasoningTokens: 0 }), '00:02'),
      event('session.usage_record', usage({ inputTokens: 14437, outputTokens: 115, cacheReadTokens: 14363, cacheWriteTokens: 71, reasoningTokens: 84 }), '00:30'),
    ])
    expect([...batch.messages.values()]).toEqual([
      {
        messageId: 'copilot:session.usage_record-00:02',
        sessionId: SESSION,
        agentId: null,
        account: 'github',
        project: 'demo',
        projectDir: '/work/demo',
        task: 'DEMO-7',
        branch: 'demo-7/task',
        entrypoint: 'copilot',
        model: 'gpt-6-luna',
        speed: null,
        effort: null,
        at: '2026-10-22T10:00:02.000Z',
        input: 3,
        cacheWrite5m: 14308,
        cacheWrite1h: 0,
        cacheRead: 0,
        output: 29,
      },
      expect.objectContaining({ messageId: 'copilot:session.usage_record-00:30', input: 3, cacheRead: 14363, cacheWrite5m: 71, output: 115 }),
    ])
    expect(batch.sessions.get(SESSION)).toEqual({
      sessionId: SESSION,
      account: 'github',
      project: 'demo',
      customTitle: null,
      aiTitle: null,
      launchTask: 'DEMO-7',
      launchReason: 'launch',
      firstAt: '2026-10-22T10:00:00.000Z',
      lastAt: '2026-10-22T10:00:30.000Z',
    })
  })

  it('takes the folder of a resume and the task from the branch when Even Keel did not launch it', () => {
    const batch = batchOf(
      [
        event('session.resume', { context: { cwd: '/work/demo/.claude/worktrees/demo-9', branch: 'demo-9/task' } }, '01:00'),
        event('session.usage_record', usage({ inputTokens: 10, outputTokens: 1 }), '01:05'),
      ],
      new Map(),
    )
    expect(batch.messages.get('copilot:session.usage_record-01:05')).toMatchObject({ task: 'DEMO-9', branch: 'demo-9/task', input: 10 })
    expect(batch.sessions.get(SESSION)).toMatchObject({ launchTask: null, launchReason: null })
  })

  it("marks a subagent's calls by its agent id", () => {
    const batch = batchOf([event('session.usage_record', usage({ inputTokens: 10, outputTokens: 1 }), '02:00', { agentId: 'explore-1' })])
    expect(batch.messages.get('copilot:session.usage_record-02:00')).toMatchObject({ sessionId: SESSION, agentId: 'explore-1' })
  })

  it('writes nothing for a session without model calls and skips a line it cannot parse', () => {
    const batch = batchOf([event('session.start', { context: { cwd: CWD } }, '00:00'), '{', event('session.usage_record', usage({ inputTokens: 0, outputTokens: 0 }), '00:01')])
    expect(batch.messages.size).toBe(0)
    expect(batch.sessions.size).toBe(0)
  })
})
