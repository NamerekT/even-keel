import { describe, expect, it } from 'vitest'
import type { AgentEntry } from '../sessions/agents.js'
import { callFailure, parseWriteAnswer, promptArg, resumeArgs, resumedAs, sessionArgs, writeArgs } from './cli.js'

describe('callFailure', () => {
  const failed = (fields: object) => Object.assign(new Error('Command failed: C:\\cli\\claude.exe -p /usage\nnoise'), fields)

  it('names the exit code and what the CLI printed, not the command line', () => {
    expect(callFailure(failed({ code: 1, killed: false, stdout: '{"is_error":true,"result":"API Error: fetch failed"}\n', stderr: '' }))).toBe(
      'exit code 1 / {"is_error":true,"result":"API Error: fetch failed"}',
    )
  })

  it('tells a timeout from an exit', () => {
    expect(callFailure(failed({ code: null, killed: true, signal: 'SIGTERM', stdout: '', stderr: 'slow' }))).toBe('timed out / slow')
  })

  it('keeps a spawn error as is', () => {
    expect(callFailure(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))).toBe('spawn claude ENOENT')
  })
})

describe('writeArgs', () => {
  it('asks for one printed turn with read-only tools, no session file, no MCP and no skills', () => {
    expect(writeArgs(null)).toEqual([
      '-p',
      '--output-format',
      'json',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--tools',
      'Read,Glob,Grep',
    ])
    expect(writeArgs('sonnet').slice(-2)).toEqual(['--model', 'sonnet'])
  })

  it('gives the turn no tool to ask, edit or run anything with', () => {
    const tools = writeArgs(null)[writeArgs(null).indexOf('--tools') + 1]!.split(',')
    for (const tool of ['AskUserQuestion', 'Edit', 'Write', 'Bash', 'NotebookEdit']) expect(tools).not.toContain(tool)
  })
})

describe('parseWriteAnswer', () => {
  it('gives the result text of a successful turn', () => {
    expect(parseWriteAnswer(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '## [v0.1]' })).text).toBe('## [v0.1]')
  })

  // Shaped as CLI 2.1.302 prints it: `modelUsage` counts every call of the turn, the top `usage` only the last one.
  it('gives the cost, the tokens of every model and the model that cost the most', () => {
    const answer = parseWriteAnswer(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '## [v0.1]',
        duration_ms: 29_000,
        total_cost_usd: 0.42,
        usage: { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        modelUsage: {
          'claude-haiku-5-5': { inputTokens: 100, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 },
          'claude-sonnet-5-5': { inputTokens: 1_000, outputTokens: 2_000, cacheReadInputTokens: 150_000, cacheCreationInputTokens: 40_000, costUSD: 0.41 },
        },
      }),
    )
    expect(answer.spend).toEqual({
      model: 'claude-sonnet-5-5',
      tokens: { input: 1_100, output: 2_010, cacheRead: 150_000, cacheWrite: 40_000 },
      cost: 0.42,
      durationMs: 29_000,
    })
  })

  it('gives no model and no cost when the answer has none', () => {
    const answer = parseWriteAnswer(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'x' }))
    expect(answer.spend).toEqual({ model: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: null, durationMs: 0 })
  })

  it('throws on an error turn and on output that is not the result', () => {
    expect(() => parseWriteAnswer(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low' }))).toThrow(
      'Credit balance is too low',
    )
    expect(() => parseWriteAnswer(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }))).toThrow('error_max_turns')
    expect(() => parseWriteAnswer('not json')).toThrow()
  })
})

describe('sessionArgs', () => {
  it('passes the chain settings with --settings only when there are any', () => {
    expect(sessionArgs('ABC-1', 'opus')).toEqual(['--bg', '--permission-mode', 'auto', '-n', 'ABC-1', '--model', 'opus'])
    expect(sessionArgs('ABC-1', 'opus', { settings: '{"syncClaudeAiSkills":false}' }).slice(-2)).toEqual(['--settings', '{"syncClaudeAiSkills":false}'])
  })

  it('passes the gateway servers first and strictly, plugin ones under the plugin, and a --plugin-dir per plugin', () => {
    const mcp = [
      { name: 'huly', plugin: 'huly', url: 'http://127.0.0.1:4748/mcp/p/huly%40even-keel@a/huly' },
      { name: 'strata', plugin: null, url: 'http://127.0.0.1:4748/mcp/p/strata@b/strata' },
    ]
    const plugins = [{ package: 'huly@even-keel', dir: 'C:\cache\huly', name: 'huly', marketplace: 'ek-a', marketplaceFile: 'C:\cache\.claude-plugin\marketplace.json', servers: ['huly'] }]
    const args = sessionArgs('ABC-1', null, { mcp, plugins })
    expect(args.slice(0, 4)).toEqual(['--bg', '--mcp-config', expect.any(String), '--strict-mcp-config'])
    expect(JSON.parse(args[2]!)).toEqual({
      mcpServers: { plugin_huly_huly: { type: 'http', url: mcp[0]!.url }, strata: { type: 'http', url: mcp[1]!.url } },
    })
    expect(args.slice(4, 6)).toEqual(['--plugin-dir', 'C:\cache\huly'])
    expect(sessionArgs('ABC-1', null, { mcp: [] }).slice(0, 4)).toEqual(['--bg', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config'])
  })

  it('passes no --model without a chosen model, so the CLI takes its configured one', () => {
    expect(sessionArgs('ABC-1', null)).toEqual(['--bg', '--permission-mode', 'auto', '-n', 'ABC-1'])
  })
})

describe('resumeArgs', () => {
  it('passes no flags when the background session keeps its saved options, so it goes on under its own id', () => {
    expect(resumeArgs('s-1', 'answer', true, 'ABC-1', 'opus', { settings: '{}' })).toEqual(['--bg', '--resume', 's-1', 'answer'])
  })

  it('passes the session flags when there is no saved background session', () => {
    expect(resumeArgs('s-1', 'answer', false, 'ABC-1', 'opus')).toEqual([...sessionArgs('ABC-1', 'opus'), '--resume', 's-1', 'answer'])
  })

  it('keeps a reply that starts with an answer line from being read as an option', () => {
    expect(resumeArgs('s-1', '- "Which color?" → Red\n', true, 'ABC-1', null).at(-1)).toBe('\n- "Which color?" → Red\n')
  })
})

describe('promptArg', () => {
  it('leaves a prompt that does not start with a dash as it is', () => {
    expect(promptArg('ABC-1\n- note')).toBe('ABC-1\n- note')
  })

  it('puts a line break before a prompt that starts with a dash', () => {
    expect(promptArg('-x')).toBe('\n-x')
  })
})

describe('resumedAs', () => {
  const since = Date.parse('2026-10-10T08:40:29Z')
  const agent = (fields: Partial<AgentEntry>): AgentEntry => ({
    id: 'job-old',
    cwd: '/repo/.claude/worktrees/ABC-1',
    kind: 'bg',
    startedAt: since + 1_000,
    sessionId: 'old',
    name: 'ABC-1',
    state: 'running',
    ...fields,
  })
  const match = resumedAs('job-old', 'old', 'ABC-1', '/repo/.claude/worktrees/ABC-1', since)

  it('finds the resumed session under its own id', () => {
    expect(match(agent({}))).toBe(true)
  })

  it('finds the copy the CLI started under a new id', () => {
    expect(match(agent({ id: 'job-new', sessionId: 'new' }))).toBe(true)
  })

  it('does not take the fresh id the respawned process of the same job shows before it loads the session', () => {
    expect(match(agent({ sessionId: 'fresh' }))).toBe(false)
  })

  it('does not take the stopped session that was resumed', () => {
    expect(match(agent({ state: 'stopped', startedAt: since - 3_600_000 }))).toBe(false)
  })

  it('does not take an earlier session of the task, another task or another folder', () => {
    expect(match(agent({ sessionId: 'earlier', startedAt: since - 3_600_000 }))).toBe(false)
    expect(match(agent({ sessionId: 'new', name: 'ABC-2' }))).toBe(false)
    expect(match(agent({ sessionId: 'new', cwd: '/repo' }))).toBe(false)
  })
})
