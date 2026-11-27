import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { AgentEntry } from '../sessions/agents.js'
import { CallTimeout, FolderCalls, type CallOptions, type CallOutput } from './calls.js'
import { NoticeError } from '../notice/notice.js'
import { expandPromptFile } from '../sessions/prompt-file.js'
import { callFailure, ClaudeCli, fittedArgs, launchedJob, parseWarmAnswer, parseWriteAnswer, promptArg, resolveClaudeBinary, resumeArgs, resumedAs, sessionArgs, warmArgs, writeArgs } from './cli.js'

// EKR-102: at the service's start the chain's `claude agents` timed out behind the /context probes and paused the chain.
describe('ClaudeCli.stop in a clogged folder queue', () => {
  class Clogged extends FolderCalls {
    readonly priorities: boolean[] = []
    constructor(private left: number) {
      super()
    }
    override run(_folder: string, file: string, args: string[], { priority = false }: CallOptions): Promise<CallOutput> {
      this.priorities.push(priority)
      if (this.left-- > 0) return Promise.reject(new CallTimeout(file, args))
      return Promise.resolve({ stdout: '[]', stderr: '' })
    }
  }
  const home: AccountHome = { key: 'one', dir: join(tmpdir(), 'even-keel-no-such-account'), global: false, agent: 'claude' }

  it('goes ahead of the waiting calls and tries again a listing that timed out in the queue', async () => {
    const calls = new Clogged(2)
    const cli = new ClaudeCli(() => 'claude', 30_000, () => ({}), calls)
    await expect(cli.stop(home, 'agent-1', 'session-1')).resolves.toBeUndefined()
    expect(calls.priorities).toEqual([true, true, true])
  })

  it('leaves the folder listing of the page an ordinary call', async () => {
    const calls = new Clogged(0)
    await new ClaudeCli(() => 'claude', 30_000, () => ({}), calls).agents(home)
    expect(calls.priorities).toEqual([false])
  })
})

describe('ClaudeCli.usage', () => {
  class Timeouts extends FolderCalls {
    readonly seen: number[] = []
    override run(_folder: string, _file: string, _args: string[], { timeoutMs }: CallOptions): Promise<CallOutput> {
      this.seen.push(timeoutMs)
      return Promise.resolve({ stdout: '', stderr: '' })
    }
  }
  const home: AccountHome = { key: 'one', dir: '/accounts/one', global: false, agent: 'claude' }

  // BTN-632: at the start /usage waits for the folder behind a /context probe per session, and its first poll timed out.
  it('waits for the folder longer than the other short calls, at most until the next poll', async () => {
    const calls = new Timeouts()
    const cli = new ClaudeCli(() => 'claude', 30_000, () => ({}), calls)
    await cli.context(home, '/work', 'sonnet')
    await cli.usage(home, '/work')
    const [context, usage] = calls.seen
    expect(context).toBe(30_000)
    expect(usage).toBeGreaterThanOrEqual(4 * context!)
    expect(usage).toBeLessThan(5 * 60_000)
  })

  // BTN-805: the model weeks come only in the `usage_report` of the stream's `/usage` message, not in the `result`.
  it('asks for the stream of messages, local and without a transcript', async () => {
    let seen: string[] = []
    const calls = new (class extends FolderCalls {
      override run(_folder: string, _file: string, args: string[]): Promise<CallOutput> {
        seen = args
        return Promise.resolve({ stdout: '', stderr: '' })
      }
    })()
    await new ClaudeCli(() => 'claude', 30_000, () => ({}), calls).usage(home, '/work')
    expect(seen).toEqual(['-p', '/usage', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'])
  })
})

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

  it('passes no name to a session the CLI titles itself, a project chat (BTN-1772)', () => {
    expect(sessionArgs('chat-0123456789ab', 'haiku', { autoTitle: true })).toEqual(['--bg', '--permission-mode', 'auto', '--model', 'haiku'])
    expect(resumeArgs('s-1', 'next', false, 'chat-0123456789ab', null, { autoTitle: true })).not.toContain('-n')
  })

  it("appends the project's lone AGENTS.md to the system prompt", () => {
    expect(sessionArgs('ABC-1', null, { instructions: 'C:\\work\\AGENTS.md' }).slice(-2)).toEqual(['--append-system-prompt-file', 'C:\\work\\AGENTS.md'])
  })

  it("passes the effort of the task's run after the model, on a resume that starts a new job and on a keep-warm fork too", () => {
    expect(sessionArgs('ABC-1', 'opus', { effort: 'xhigh' }).slice(-4)).toEqual(['--model', 'opus', '--effort', 'xhigh'])
    expect(sessionArgs('ABC-1', null, { effort: 'low' }).slice(-2)).toEqual(['--effort', 'low'])
    expect(resumeArgs('s-1', 'answer', false, 'ABC-1', null, { effort: 'max' })).toEqual([...sessionArgs('ABC-1', null, { effort: 'max' }), '--resume', 's-1', 'answer'])
    expect(warmArgs('s-1', 'opus', { effort: 'high' }).slice(9, 15)).toEqual(['--permission-mode', 'dontAsk', '--model', 'opus', '--effort', 'high'])
    expect(warmArgs('s-1', 'opus')).not.toContain('--effort')
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

describe('warmArgs', () => {
  it('forks the session with no transcript for one call that may change nothing', () => {
    const args = warmArgs('s-1', 'claude-haiku-5-5')
    expect(args.slice(0, 9)).toEqual(['-p', '--resume', 's-1', '--fork-session', '--no-session-persistence', '--output-format', 'json', '--max-turns', '1'])
    expect(args.slice(9)).toEqual(['--permission-mode', 'dontAsk', '--model', 'claude-haiku-5-5', '--settings', '{"disableAllHooks":true}'])
  })

  it("passes the session's own servers, plugins, settings and instructions, with the hooks off", () => {
    const mcp = [{ name: 'strata', plugin: null, url: 'http://127.0.0.1:4748/mcp/p/strata@b/strata' }]
    const plugins = [{ package: 'huly@even-keel', dir: 'C:\\cache\\huly', name: 'huly', marketplace: 'ek-a', marketplaceFile: 'C:\\cache\\m.json', servers: [] }]
    const settings = '{"promptCacheTtl":"1h","env":{"HULY_TOKEN":""}}'
    const args = warmArgs('s-1', null, { mcp, plugins, settings, instructions: 'C:\\work\\AGENTS.md' }).slice(9)
    const session = sessionArgs('ABC-1', null, { mcp, plugins }).slice(1, 6)
    expect(args.slice(0, 5)).toEqual(session)
    expect(args.slice(5, 7)).toEqual(['--permission-mode', 'dontAsk'])
    expect(JSON.parse(args[args.indexOf('--settings') + 1]!)).toEqual({ promptCacheTtl: '1h', env: { HULY_TOKEN: '' }, disableAllHooks: true })
    expect(args.slice(-2)).toEqual(['--append-system-prompt-file', 'C:\\work\\AGENTS.md'])
  })
})

describe('parseWarmAnswer', () => {
  const usage = { input_tokens: 2, cache_creation_input_tokens: 101, cache_read_input_tokens: 22478, output_tokens: 4 }

  it("takes the tokens of the ping's own call, not the fork's running totals", () => {
    const answer = parseWarmAnswer(
      JSON.stringify({
        type: 'result', subtype: 'success', is_error: false, result: 'ok', duration_ms: 2400, total_cost_usd: 0.0028, usage,
        modelUsage: { 'claude-haiku-5-5': { inputTokens: 1192, cacheReadInputTokens: 103506, cacheCreationInputTokens: 7173, costUSD: 0.0028 } },
      }),
      'claude-haiku-5-5',
    )
    expect(answer).toEqual({ model: 'claude-haiku-5-5', tokens: { input: 2, output: 4, cacheRead: 22478, cacheWrite: 101 }, cost: null, durationMs: 2400 })
  })

  it('counts a fork that answered with a tool call by the usage of its one request (BTN-1507)', () => {
    const answer = parseWarmAnswer(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['Reached maximum number of turns (1)'], usage }), null)
    expect(answer.tokens).toEqual({ input: 2, output: 4, cacheRead: 22478, cacheWrite: 101 })
    expect(() => parseWarmAnswer(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }), null)).toThrow('error_max_turns')
  })

  it('throws when the fork failed', () => {
    expect(() => parseWarmAnswer(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low', usage }), null)).toThrow(
      'Credit balance is too low',
    )
  })

  it('keeps the overload refusal from a failed fork for keep-warm to skip it', () => {
    expect(() => parseWarmAnswer(JSON.stringify({ subtype: 'error_during_execution', is_error: true, errors: ['API Error: 529 overloaded_error'] }), null)).toThrow('overloaded_error')
  })
})

// BTN-1505: a handoff prompt past Windows' 32,767-character line failed with `spawn ENAMETOOLONG` and an empty reason.
describe('fittedArgs', () => {
  const binary = 'C:\\Users\\someone\\.local\\bin\\claude.exe'
  let cwd: string
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'even-keel-fitted-'))
  })
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('leaves a prompt that fits on the line', async () => {
    const args = [...sessionArgs('ABC-1', 'opus'), 'Задача ABC-1']
    expect(await fittedArgs(binary, args, [], cwd, 'win32')).toEqual(args)
  })

  it('puts a launch prompt longer than the line into a file and passes a pointer to it', async () => {
    const prompt = 'Записка хендоффа: "кавычки" и \\слэши\\\n'.repeat(1_500)
    expect(prompt.length).toBeGreaterThan(32_767)
    const fitted = await fittedArgs(binary, [...sessionArgs('ABC-1', 'opus'), promptArg(prompt)], [], cwd, 'win32')
    expect(fitted.slice(0, -1)).toEqual(sessionArgs('ABC-1', 'opus'))
    expect(fitted.at(-1)!.length).toBeLessThan(300)
    expect(expandPromptFile(fitted.at(-1)!, cwd)).toBe(prompt)
  })

  it('puts a long reply of a resume into a file the same way', async () => {
    const reply = 'ответ '.repeat(6_000)
    const fitted = await fittedArgs(binary, resumeArgs('s-1', reply, true, 'ABC-1', 'opus'), [], cwd, 'win32')
    expect(fitted.slice(0, -1)).toEqual(['--bg', '--resume', 's-1'])
    expect(expandPromptFile(fitted.at(-1)!, cwd)).toBe(reply)
  })

  it('counts the flags the daemon puts back on a kept job\'s line', async () => {
    const settings = JSON.stringify({ padding: 'x'.repeat(21_000) })
    const args = resumeArgs('s-1', 'y'.repeat(12_000), true, 'ABC-1', 'opus', { settings })
    expect((await fittedArgs(binary, args, [], cwd, 'win32')).at(-1)!.length).toBe(12_000)
    const saved = sessionArgs('ABC-1', 'opus', { settings })
    expect((await fittedArgs(binary, args, saved, cwd, 'win32')).at(-1)!.length).toBeLessThan(300)
  })
})

describe('a launch that never ran', () => {
  it('names the spawn error, which printed nothing, as the reason', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'even-keel-nolaunch-'))
    const home: AccountHome = { key: 'one', dir: cwd, global: false, agent: 'claude' }
    const cli = new ClaudeCli(() => join(cwd, 'no-such-claude.exe'), 30_000, () => ({}), new FolderCalls())
    const failure = await cli.launch(home, 'ABC-1', cwd, 'prompt', null).catch((error: unknown) => error)
    await rm(cwd, { recursive: true, force: true })
    expect(failure).toBeInstanceOf(NoticeError)
    expect((failure as NoticeError).notice).toMatchObject({ code: 'claude.startFailed', detail: expect.stringContaining('ENOENT') })
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

  // BTN-1772: a chat's session has no name of ours, and the one the CLI lists floats (the prompt, then its title).
  describe('of a session started without a name', () => {
    const chat = (fields: Partial<AgentEntry>) => agent({ cwd: '/repo', name: 'explain cherry-pick', ...fields })

    it('takes the copy by the job the CLI printed, whatever its listed name', () => {
      const printed = resumedAs('job-old', 'old', 'chat-0123456789ab', '/repo', since, 'job-new')
      expect(printed(chat({ id: 'job-new', sessionId: 'new' }))).toBe(true)
      expect(printed(chat({ id: 'job-other', sessionId: 'other' }))).toBe(false)
      expect(printed(chat({}))).toBe(true)
      expect(printed(chat({ sessionId: 'fresh' }))).toBe(false)
    })

    it('takes a new job of the folder when the CLI printed none', () => {
      const unprinted = resumedAs('job-old', 'old', 'chat-0123456789ab', '/repo', since, null)
      expect(unprinted(chat({ id: 'job-new', sessionId: 'new' }))).toBe(true)
      expect(unprinted(chat({ id: 'job-new', sessionId: 'new', cwd: '/elsewhere' }))).toBe(false)
      expect(unprinted(chat({ id: 'job-new', sessionId: 'new', startedAt: since - 3_600_000 }))).toBe(false)
    })
  })
})

describe('launchedJob', () => {
  it('reads the job id `claude --bg` prints, with or without a name after it', () => {
    expect(launchedJob('backgrounded · 45bc7845\n')).toBe('45bc7845')
    expect(launchedJob('backgrounded · 45bc7845 · probe-title-a\n')).toBe('45bc7845')
    expect(launchedJob('something else')).toBeNull()
  })
})

// BTN-648: the daemon retired a job and exited, its state.json stayed `blocked`; every Resume paused the chain on `claude stop`.
describe('a job the daemon no longer holds', () => {
  const job = { id: '3788ee8d', sessionId: 'session-1', cwd: '/work', kind: 'bg', startedAt: 1, name: 'ABC-1', state: 'blocked' }
  class Agents extends FolderCalls {
    override run(): Promise<CallOutput> {
      return Promise.resolve({ stdout: JSON.stringify([job]), stderr: '' })
    }
  }
  const cli = new ClaudeCli(() => join(tmpdir(), 'no-such-claude'), 30_000, () => ({}), new Agents())
  let home: AccountHome

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'even-keel-roster-'))
    home = { key: 'one', dir, global: false, agent: 'claude' }
    await mkdir(join(dir, 'jobs', job.id), { recursive: true })
    await writeFile(join(dir, 'jobs', job.id, 'state.json'), JSON.stringify({ state: 'blocked', tempo: 'blocked', detail: 'Credit balance is too low' }))
    await mkdir(join(dir, 'daemon'))
  })
  afterEach(async () => {
    await rm(home.dir, { recursive: true, force: true })
  })

  const roster = (supervisorPid: number, updatedAt: number, workers: string[]) =>
    writeFile(join(home.dir, 'daemon', 'roster.json'), JSON.stringify({ proto: 1, supervisorPid, updatedAt, workers: Object.fromEntries(workers.map((id) => [id, { pid: 1 }])) }))

  it('is abandoned when the daemon exited and left no roster', async () => {
    const [entry] = await cli.agents(home)
    expect(entry).toMatchObject({ abandoned: true })
    expect(entry?.startupDialog).toBeUndefined()
  })

  it('is abandoned when the roster has no such worker', async () => {
    await roster(process.pid, Date.now() + 60_000, [])
    expect((await cli.agents(home))[0]).toMatchObject({ abandoned: true })
  })

  it('is abandoned when the roster still lists it but its supervisor is gone and the pid now names a later process', async () => {
    await roster(process.pid, 0, [job.id])
    expect((await cli.agents(home))[0]).toMatchObject({ abandoned: true })
  })

  it('is stopped at once, without calling the CLI', async () => {
    await expect(cli.stop(home, job.id, job.sessionId)).resolves.toBeUndefined()
  })

  it('is not abandoned while a live daemon holds it, as a session starting before its first turn', async () => {
    await roster(process.pid, Date.now() + 60_000, [job.id])
    const [entry] = await cli.agents(home)
    expect(entry?.abandoned).toBeUndefined()
    expect(entry?.startupDialog).toBe('Credit balance is too low')
    await expect(cli.stop(home, job.id, job.sessionId)).rejects.toThrow()
  })

  it('is not abandoned when the roster cannot be read', async () => {
    await writeFile(join(home.dir, 'daemon', 'roster.json'), '{')
    expect((await cli.agents(home))[0]?.abandoned).toBeUndefined()
  })
})

describe('resolveClaudeBinary', () => {
  const windows = (...files: string[]) => ({ platform: 'win32' as const, arch: 'x64', home: 'C:\\Users\\john', runnable: (path: string) => files.includes(path) })
  const npm = 'C:\\Users\\john\\AppData\\Roaming\\npm'
  const env = { APPDATA: 'C:\\Users\\john\\AppData\\Roaming', Path: `C:\\Windows;${npm}` }
  const wrapper = `${npm}\\node_modules\\@anthropic-ai\\claude-code`
  const native = `${wrapper}\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe`
  const standalone = 'C:\\Users\\john\\.local\\bin\\claude.exe'

  it('takes the variable, then the checked copy', () => {
    expect(resolveClaudeBinary({ ...env, EVEN_KEEL_CLAUDE_BIN: 'D:\\tools\\claude.exe' }, 'D:\\copy\\claude.exe', windows(native))).toBe('D:\\tools\\claude.exe')
    expect(resolveClaudeBinary(env, 'D:\\copy\\claude.exe', windows(native))).toBe('D:\\copy\\claude.exe')
  })

  it('finds the native claude.exe of an npm install whose postinstall did not run (BTN-1196)', () => {
    expect(resolveClaudeBinary(env, undefined, windows(native))).toBe(native)
    const hoisted = `${npm}\\node_modules\\@anthropic-ai\\claude-code-win32-x64\\claude.exe`
    expect(resolveClaudeBinary(env, undefined, windows(hoisted))).toBe(hoisted)
  })

  it('puts the native installer first and falls back to the bare name', () => {
    expect(resolveClaudeBinary(env, undefined, windows(standalone, native))).toBe(standalone)
    expect(resolveClaudeBinary(env, undefined, windows(`${npm}\\claude.cmd`))).toBe('claude')
  })

  it('finds the platform package on Linux behind the placeholder npm links onto the PATH', () => {
    const modules = '/usr/local/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai'
    const linux = (...files: string[]) => ({ platform: 'linux' as const, arch: 'arm64', home: '/home/john', runnable: (path: string) => files.includes(path) })
    const glibc = `${modules}/claude-code-linux-arm64/claude`
    const musl = `${modules}/claude-code-linux-arm64-musl/claude`
    expect(resolveClaudeBinary({ PATH: '/usr/local/bin:/usr/bin' }, undefined, linux(glibc))).toBe(glibc)
    expect(resolveClaudeBinary({ PATH: '/usr/local/bin:/usr/bin' }, undefined, linux(musl))).toBe(musl)
  })
})
