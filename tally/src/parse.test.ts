import { describe, expect, it } from 'vitest'
import { BatchBuilder, errorKindOf, launchMap } from './parse.js'

const base = {
  sessionId: 's1',
  cwd: 'D:\\Projects\\Baton\\.claude\\worktrees\\btn-46',
  gitBranch: 'btn-46/task',
  entrypoint: 'cli',
}

function assistant(uuid: string, at: string, content: unknown[], usage: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    ...base,
    type: 'assistant',
    uuid,
    timestamp: at,
    message: { id: 'msg_1', model: 'claude-opus-5-5', content, usage },
    ...extra,
  })
}

function toolResult(uuid: string, id: string, content: unknown, isError: boolean) {
  return JSON.stringify({
    ...base,
    type: 'user',
    uuid,
    timestamp: '2026-10-03T10:00:05.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] },
    toolUseResult: { stdout: 'copy' },
  })
}

function build(lines: string[], launches = launchMap([])) {
  const builder = new BatchBuilder({ account: 'global', launches })
  for (const line of lines) builder.push(line)
  return builder.batch
}

const usage = {
  input_tokens: 3,
  cache_creation_input_tokens: 300,
  cache_read_input_tokens: 5000,
  output_tokens: 10,
  cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
  speed: 'standard',
}

describe('BatchBuilder messages', () => {
  it('folds the lines of one response into one message with the last usage', () => {
    const batch = build([
      assistant('u1', '2026-10-03T10:00:00.000Z', [{ type: 'thinking', thinking: '', signature: 'sig' }], usage),
      assistant('u2', '2026-10-03T10:00:01.000Z', [{ type: 'text', text: 'done' }], { ...usage, output_tokens: 250 }),
    ])
    expect([...batch.messages.values()]).toEqual([
      {
        messageId: 'msg_1',
        sessionId: 's1',
        agentId: null,
        account: 'global',
        project: 'Baton',
        projectDir: 'D:\\Projects\\Baton',
        task: 'BTN-46',
        branch: 'btn-46/task',
        entrypoint: 'cli',
        model: 'claude-opus-5-5',
        speed: 'standard',
        at: '2026-10-03T10:00:00.000Z',
        input: 3,
        cacheWrite5m: 100,
        cacheWrite1h: 200,
        cacheRead: 5000,
        output: 250,
      },
    ])
    expect([...batch.lines.keys()]).toEqual(['u1', 'u2'])
  })

  it('counts cache writes without a breakdown as 5 minute writes', () => {
    const batch = build([assistant('u1', '2026-10-03T10:00:00.000Z', [], { input_tokens: 1, cache_creation_input_tokens: 70, output_tokens: 2 })])
    const message = batch.messages.get('msg_1')!
    expect([message.cacheWrite5m, message.cacheWrite1h, message.cacheRead]).toEqual([70, 0, 0])
  })

  it('skips synthetic and API error responses as messages but keeps the lines', () => {
    const batch = build([
      assistant('u1', '2026-10-03T10:00:00.000Z', [{ type: 'text', text: 'limit' }], usage, {
        isApiErrorMessage: true,
        message: { id: 'msg_e', model: '<synthetic>', content: [], usage },
      }),
    ])
    expect(batch.messages.size).toBe(0)
    expect(batch.lines.size).toBe(1)
  })

  it('takes the task from the launch journal first', () => {
    const launches = launchMap([
      { at: '2026-10-03T09:00:00.000Z', project: 'BTN', task: 'BTN-50', sessionId: 's1' },
      { at: '2026-10-03T09:30:00.000Z', project: 'BTN', task: 'BTN-50', sessionId: 's1', reason: 'skip' },
    ])
    const batch = build([assistant('u1', '2026-10-03T10:00:00.000Z', [], usage)], launches)
    expect(batch.messages.get('msg_1')!.task).toBe('BTN-50')
    expect(batch.sessions.get('s1')).toMatchObject({ launchTask: 'BTN-50', launchReason: 'launch' })
  })

  it('marks subagent messages with their agent', () => {
    const batch = build([assistant('u1', '2026-10-03T10:00:00.000Z', [], usage, { isSidechain: true, agentId: 'a7' })])
    expect(batch.messages.get('msg_1')).toMatchObject({ sessionId: 's1', agentId: 'a7' })
  })
})

describe('BatchBuilder tool calls', () => {
  const call = assistant(
    'u1',
    '2026-10-03T10:00:00.000Z',
    [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test\nmore', description: 'Run tests' } }],
    usage,
  )

  it('records the call with a brief and an input hash', () => {
    const row = build([call]).calls.get('toolu_1')!
    expect(row).toMatchObject({ toolUseId: 'toolu_1', sessionId: 's1', messageId: 'msg_1', task: 'BTN-46', name: 'Bash', at: '2026-10-03T10:00:00.000Z' })
    expect(row.brief).toBe('Bash Run tests')
    expect(row.inputHash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('records a failed result with its kind and text, without the toolUseResult copy', () => {
    const batch = build([call, toolResult('u2', 'toolu_1', 'Exit code 1\nboom', true)])
    expect(batch.results.get('toolu_1')).toEqual({
      toolUseId: 'toolu_1',
      resultAt: '2026-10-03T10:00:05.000Z',
      isError: true,
      errorKind: 'error',
      errorText: 'Exit code 1\nboom',
    })
    expect(batch.lines.get('u2')!.raw).not.toHaveProperty('toolUseResult')
  })

  it('records a successful result without error fields', () => {
    const batch = build([toolResult('u2', 'toolu_1', [{ type: 'text', text: 'ok' }], false)])
    expect(batch.results.get('toolu_1')).toMatchObject({ isError: false, errorKind: null, errorText: null })
  })

  it('reads the error text from text blocks', () => {
    const batch = build([toolResult('u2', 'toolu_1', [{ type: 'text', text: "The user doesn't want to proceed with this tool use." }], true)])
    expect(batch.results.get('toolu_1')).toMatchObject({ errorKind: 'denied' })
  })
})

describe('errorKindOf', () => {
  it('tells permission denials apart', () => {
    expect(errorKindOf("The user doesn't want to proceed with this tool use. The tool use was rejected")).toBe('denied')
    expect(errorKindOf('Permission for this action was denied by the auto mode classifier')).toBe('denied')
    expect(errorKindOf('Bash permission to run rm was denied')).toBe('denied')
  })

  it('tells hook errors apart', () => {
    expect(errorKindOf('PreToolUse:Bash hook error: blocked')).toBe('hook')
    expect(errorKindOf('PostToolUse:Edit hook error')).toBe('hook')
  })

  it('calls everything else an error', () => {
    expect(errorKindOf('Exit code 2')).toBe('error')
    expect(errorKindOf('<tool_use_error>File has not been read yet</tool_use_error>')).toBe('error')
  })
})

describe('BatchBuilder sessions', () => {
  it('collects titles and the time span', () => {
    const batch = build([
      JSON.stringify({ type: 'ai-title', aiTitle: 'Auto title', sessionId: 's1' }),
      assistant('u1', '2026-10-03T10:00:00.000Z', [], usage),
      assistant('u2', '2026-10-03T11:00:00.000Z', [], usage),
      JSON.stringify({ type: 'custom-title', customTitle: 'My title', sessionId: 's1' }),
    ])
    expect(batch.sessions.get('s1')).toEqual({
      sessionId: 's1',
      account: 'global',
      project: 'Baton',
      customTitle: 'My title',
      aiTitle: 'Auto title',
      launchTask: null,
      launchReason: null,
      firstAt: '2026-10-03T10:00:00.000Z',
      lastAt: '2026-10-03T11:00:00.000Z',
    })
  })

  it('ignores broken lines', () => {
    const batch = build(['{"type":"assistant"', '', '[1,2]'])
    expect(batch.lines.size + batch.messages.size + batch.sessions.size).toBe(0)
  })
})
