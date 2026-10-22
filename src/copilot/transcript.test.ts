import { describe, expect, it } from 'vitest'
import { claudeCall, foldEvents, patchCalls } from './transcript.js'

/** Events as Copilot CLI 1.0.98 writes them into `session-state/<id>/events.jsonl`, trimmed to the fields read. */
const T0 = Date.parse('2026-10-22T10:00:00.000Z')
const CWD = 'C:\\work\\demo'

function event(offset: number, type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, data, id: `e${offset}`, timestamp: new Date(T0 + offset * 1000).toISOString(), parentId: null, ...extra })
}

function usage(offset: number, tokens: { input: number; output: number; read: number; write: number }, extra: Record<string, unknown> = {}): string {
  const record = { model: 'gpt-6-luna', inputTokens: tokens.input, outputTokens: tokens.output, cacheReadTokens: tokens.read, cacheWriteTokens: tokens.write, reasoningTokens: 0, cost: 1, maxPromptTokens: 272_000 }
  return event(offset, 'session.usage_record', { usage: record }, extra)
}

function call(offset: number, id: string, name: string, args: unknown, content = ''): string {
  return event(offset, 'assistant.message', { messageId: `m${offset}`, model: 'gpt-6-luna', content, toolRequests: [{ toolCallId: id, name, arguments: args }] })
}

function reply(offset: number, content: string): string {
  return event(offset, 'assistant.message', { messageId: `m${offset}`, model: 'gpt-6-luna', content, toolRequests: [] })
}

const start = event(0, 'session.start', { sessionId: 'abc', copilotVersion: '1.0.98', context: { cwd: CWD, gitRoot: CWD, branch: 'demo-1/task' } })
const prompt = event(1, 'user.message', { content: 'DEMO-1', transformedContent: '<current_datetime>…</current_datetime>\n\nDEMO-1' })

describe('foldEvents', () => {
  it('takes the folder and branch from the start, the context and window from the last call, the tokens summed', () => {
    const summary = foldEvents(
      [
        start,
        prompt,
        event(2, 'assistant.turn_start', { turnId: '0' }),
        usage(3, { input: 14_311, output: 29, read: 0, write: 14_308 }),
        call(3, 'call_1', 'powershell', { command: 'git status --short', description: 'Check short Git status' }),
        event(4, 'tool.execution_complete', { toolCallId: 'call_1', success: true, result: { content: '' } }),
        usage(5, { input: 14_366, output: 19, read: 14_308, write: 55 }),
        reply(5, 'The working tree is clean.'),
      ].join('\n'),
    )
    expect(summary.workdir).toBe(CWD)
    expect(summary.gitBranch).toBe('demo-1/task')
    expect(summary.model).toBe('gpt-6-luna')
    expect(summary.contextTokens).toBe(14_366)
    expect(summary.contextWindow).toBe(272_000)
    expect(summary.tokens).toEqual({ input: 6, output: 48, cacheRead: 14_308, cacheWrite: 14_363 })
    expect(summary.turn).toEqual({ startedAt: '2026-10-22T10:00:01.000Z', tool: null })
    expect(summary.feed.map((line) => [line.kind, line.text])).toEqual([
      ['prompt', 'DEMO-1'],
      ['tool', 'Shell Check short Git status'],
      ['text', 'The working tree is clean.'],
    ])
    expect(summary.lastMessage).toBe('The working tree is clean.')
  })

  it('shows a call without its result as the running tool and moves the stage by the command', () => {
    const summary = foldEvents([start, prompt, call(2, 'call_1', 'powershell', { command: 'npm test' })].join('\n'))
    expect(summary.turn?.tool).toBe('Shell npm test')
    expect(summary.stage).toBe('test')
  })

  it("counts a subagent's tokens in the totals but not in the context", () => {
    const summary = foldEvents(
      [start, prompt, usage(2, { input: 1000, output: 10, read: 0, write: 0 }), usage(3, { input: 50_000, output: 5, read: 0, write: 0 }, { agentId: 'sub' })].join('\n'),
    )
    expect(summary.contextTokens).toBe(1000)
    expect(summary.tokens.input).toBe(51_000)
  })

  it('reads the checkpoint, the pull request and NO CHANGES from the last text, and resets them at a new prompt', () => {
    const ended = foldEvents([start, prompt, reply(2, 'Saved the notes.\nCHECKPOINT: .temp/handoff.md')].join('\n'))
    expect(ended.checkpoint).toBe('.temp/handoff.md')
    const again = foldEvents([start, prompt, reply(2, 'CHECKPOINT: .temp/handoff.md'), event(3, 'user.message', { content: 'go on' })].join('\n'))
    expect(again.checkpoint).toBeNull()
  })

  it('takes a rate limit as a limit and a missing billing as credit', () => {
    const limit = foldEvents([start, prompt, event(2, 'session.error', { errorType: 'rate_limit', message: 'You have hit the rate limit' })].join('\n'))
    expect(limit.apiError).toMatchObject({ kind: 'limit', text: 'You have hit the rate limit' })
    const credit = foldEvents([start, prompt, event(2, 'session.error', { errorType: 'error', errorCode: 'billing_not_configured', message: 'Billing is off' })].join('\n'))
    expect(credit.apiError?.kind).toBe('credit')
    const other = foldEvents([start, prompt, event(2, 'session.error', { errorType: 'error', message: 'socket hang up' })].join('\n'))
    expect(other.apiError?.kind).toBe('error')
  })

  it('adds the commands and the failed results to the whole feed', () => {
    const summary = foldEvents(
      [
        start,
        prompt,
        call(2, 'call_1', 'powershell', { command: 'npm test', description: 'Run tests' }),
        event(3, 'tool.execution_complete', { toolCallId: 'call_1', success: false, shellExecution: { exitCode: 1 }, result: { content: '1 failed' } }),
      ].join('\n'),
      Infinity,
      true,
    )
    expect(summary.feed[1]).toMatchObject({ kind: 'tool', detail: 'npm test', tool: 'call_1' })
    expect(summary.feed[2]).toMatchObject({ kind: 'failed', tool: 'call_1' })
    expect(summary.feed[2]!.text).toContain('Exit code 1')
  })

  it('skips broken lines and events without a time', () => {
    const summary = foldEvents(['{oops', JSON.stringify({ type: 'user.message', data: { content: 'x' } }), start, prompt].join('\n'))
    expect(summary.feed).toHaveLength(1)
  })
})

describe('claudeCall', () => {
  it("names Copilot's tools and their input keys as Claude Code does", () => {
    expect(claudeCall('view', { path: 'src/a.ts' })).toEqual({ name: 'Read', input: { file_path: 'src/a.ts' } })
    expect(claudeCall('edit', { path: 'a.ts', old_str: 'x', new_str: 'y' })).toEqual({ name: 'Edit', input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' } })
    expect(claudeCall('bash', { command: 'ls' }).name).toBe('Shell')
  })

  it("reads an MCP tool as the gateway's server and the tool, and leaves Copilot's own dashed names", () => {
    expect(claudeCall('plugin_huly_huly-get_issue', {}).name).toBe('mcp__plugin_huly_huly__get_issue')
    expect(claudeCall('github-mcp-server-get_me', {}).name).toBe('mcp__github-mcp-server__get_me')
    expect(claudeCall('read_powershell', {}).name).toBe('read_powershell')
  })
})

describe('patchCalls', () => {
  it('makes a line per file of the patch with its size', () => {
    const patch = ['*** Begin Patch', '*** Add File: b.txt', '+hi', '*** Update File: a.ts', '-old', '+new', '+more', '*** End Patch'].join('\n')
    expect(patchCalls(patch)).toEqual([
      { name: 'Write', input: { file_path: 'b.txt' }, size: { added: 1, removed: 0 } },
      { name: 'Edit', input: { file_path: 'a.ts' }, size: { added: 2, removed: 1 } },
    ])
  })

  it('falls back to one edit for a patch it cannot read', () => {
    expect(patchCalls(undefined)).toEqual([{ name: 'Edit', input: {} }])
  })
})
