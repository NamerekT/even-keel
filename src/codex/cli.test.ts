import { describe, expect, it } from 'vitest'
import { forkSpend, listedModels, parseLoginStatus, parseWriteAnswer, turnArgs, warmArgs, writeArgs } from './cli.js'
import { mcpArgs } from './mcp.js'

describe('listedModels', () => {
  it("takes the models of the app-server's list, the hidden ones left out", () => {
    const answer = {
      data: [
        { id: 'gpt-reserve', model: 'gpt-reserve', hidden: true },
        { id: 'gpt-6-luna', model: 'gpt-6-luna', hidden: false, isDefault: true },
        { id: 'gpt-5.6-terra', model: 'gpt-5.6-terra', hidden: false },
      ],
      nextCursor: null,
    }
    expect(listedModels(answer)).toEqual(['gpt-6-luna', 'gpt-5.6-terra'])
    expect(listedModels(null)).toEqual([])
  })
})

describe('writeArgs', () => {
  it('asks for one read-only turn that keeps no rollout, prints its events and reads the prompt from stdin', () => {
    expect(writeArgs(null)).toEqual(['exec', '--json', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '-'])
    expect(writeArgs('gpt-6.1-sol')).toEqual(['exec', '--json', '--sandbox', 'read-only', '--ephemeral', '--color', 'never', '-m', 'gpt-6.1-sol', '-'])
  })
})

describe('warmArgs', () => {
  const ID = '01a19652-0000-7000-8000-000000000000'

  it("forks the session read-only with no hooks and no rollout, its model, servers and plugins before fork, the prompt on stdin", () => {
    const start = { model: 'gpt-6.1-sol', mcp: [{ name: 'huly', url: 'http://127.0.0.1:4747/mcp/huly' }] }
    expect(warmArgs(start, ID, ['-c', 'plugins.x=1'])).toEqual([
      'exec',
      '--json',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--disable',
      'hooks',
      '-c',
      'project_doc_fallback_filenames=["CLAUDE.md"]',
      '-m',
      'gpt-6.1-sol',
      ...mcpArgs(start.mcp),
      '-c',
      'plugins.x=1',
      'fork',
      ID,
      '-',
    ])
    expect(warmArgs({ model: null }, ID).slice(-4)).toEqual(['project_doc_fallback_filenames=["CLAUDE.md"]', 'fork', ID, '-'])
  })

  it('forks in a folder that is no repository', () => {
    expect(warmArgs({ model: null, outsideRepo: true }, ID).slice(0, 4)).toEqual(['exec', '--json', '--skip-git-repo-check', '--ephemeral'])
  })

  it('forks with the window the session was started with', () => {
    expect(warmArgs({ model: null, contextWindow: 250_000 }, ID).slice(-7)).toEqual(['-c', 'model_context_window=250000', '-c', 'model_auto_compact_token_limit=218000', 'fork', ID, '-'])
  })
})

describe('forkSpend', () => {
  it("takes the source session's total out of the fork's usage, which adds it to the fork's own request", () => {
    const fork = { model: 'gpt-6-luna', tokens: { input: 42_069, output: 1_020, cacheRead: 62_592, cacheWrite: 0 }, cost: null, durationMs: 3_000 }
    const source = { input: 40_442, output: 1_015, cacheRead: 11_136, cacheWrite: 0 }
    expect(forkSpend(fork, source)).toEqual({ ...fork, tokens: { input: 1_627, output: 5, cacheRead: 51_456, cacheWrite: 0 } })
  })

  it('counts nothing below zero when the source total outgrew the fork', () => {
    const fork = { model: null, tokens: { input: 10, output: 1, cacheRead: 100, cacheWrite: 0 }, cost: null, durationMs: 0 }
    expect(forkSpend(fork, { input: 20, output: 0, cacheRead: 50, cacheWrite: 0 }).tokens).toEqual({ input: 0, output: 1, cacheRead: 50, cacheWrite: 0 })
  })
})

describe('parseWriteAnswer', () => {
  const events = (...lines: object[]) => lines.map((line) => JSON.stringify(line)).join('\n')

  it('gives the last message and the tokens of the turn, no cost', () => {
    const answer = parseWriteAnswer(
      events(
        { type: 'thread.started', thread_id: 't' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Reading the tasks.' } },
        { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'ls' } },
        { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: '## [0.1.0]\n\n- A' } },
        { type: 'turn.completed', usage: { input_tokens: 50_000, cached_input_tokens: 30_000, output_tokens: 2_000 } },
      ),
      'gpt-6.1-sol',
      12_000,
    )
    expect(answer).toEqual({
      text: '## [0.1.0]\n\n- A',
      spend: { model: 'gpt-6.1-sol', tokens: { input: 20_000, output: 2_000, cacheRead: 30_000, cacheWrite: 0 }, cost: null, durationMs: 12_000 },
    })
  })

  it("throws with Codex's words when the turn failed or said nothing", () => {
    expect(() =>
      parseWriteAnswer(events({ type: 'turn.started' }, { type: 'turn.failed', error: { message: 'model not supported' } }), null, 0),
    ).toThrow('model not supported')
    expect(() => parseWriteAnswer(events({ type: 'turn.started' }, { type: 'turn.completed', usage: {} }), null, 0)).toThrow('no message')
  })
})

const token = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

describe('parseLoginStatus', () => {
  const auth = JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { id_token: token({ email: 'john.doe@example.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } }) },
  })

  it('reads a ChatGPT sign-in with the e-mail and the plan of its token', () => {
    expect(parseLoginStatus('Logged in using ChatGPT\n', auth)).toEqual({
      loggedIn: true,
      authMethod: 'chatgpt',
      email: 'john.doe@example.com',
      orgName: null,
      subscriptionType: 'plus',
    })
  })

  it('reads an API key sign-in and a signed-out folder', () => {
    expect(parseLoginStatus('Logged in using an API key - sk-***\n', undefined)).toMatchObject({ loggedIn: true, authMethod: 'api_key', email: null })
    expect(parseLoginStatus('Not logged in\n', auth)).toMatchObject({ loggedIn: false, authMethod: null, email: null })
  })

  it('reads the API key line of codex-cli 0.164', () => {
    const text = 'API key configured - sk-proj-***xTfMA\nAuthentication is checked when you send a request.\n'
    expect(parseLoginStatus(text, undefined)).toMatchObject({ loggedIn: true, authMethod: 'api_key', email: null })
  })

  it('does without a readable token', () => {
    expect(parseLoginStatus('Logged in using ChatGPT', '{"tokens":{"id_token":"broken"}}')).toMatchObject({ loggedIn: true, email: null, subscriptionType: null })
  })

  it('refuses output it does not know', () => {
    expect(() => parseLoginStatus('Error: something else', undefined)).toThrow(/neither/)
  })
})

describe('turnArgs', () => {
  const fallback = ['-c', 'project_doc_fallback_filenames=["CLAUDE.md"]']

  it("starts a session in the chain mode with the JSON stream, reading the project's CLAUDE.md without an AGENTS.md", () => {
    expect(turnArgs({ model: null }, 'BTN-1')).toEqual(['exec', '--json', '--approve-for-me', ...fallback, 'BTN-1'])
  })

  it("passes the effort of the task's run as a config value on a first turn, a resumed one and a keep-warm fork", () => {
    const effort = ['-c', 'model_reasoning_effort="high"']
    const within = (args: string[]) => args.some((arg, index) => arg === effort[0] && args[index + 1] === effort[1])
    expect(within(turnArgs({ model: null, effort: 'high' }, 'BTN-1'))).toBe(true)
    expect(within(turnArgs({ model: 'gpt-example', effort: 'high' }, 'go on', 'session-1'))).toBe(true)
    expect(within(warmArgs({ model: null, effort: 'high' }, 'session-1'))).toBe(true)
    expect(turnArgs({ model: null }, 'BTN-1').join(' ')).not.toContain('model_reasoning_effort')
  })

  it('runs in a folder that is no repository, on a resumed turn too', () => {
    expect(turnArgs({ model: null, outsideRepo: true }, 'NOTE-1')).toEqual(['exec', '--json', '--skip-git-repo-check', '--approve-for-me', ...fallback, 'NOTE-1'])
    expect(turnArgs({ model: null, outsideRepo: true }, 'NOTE-1', 'thread-1').slice(-3)).toEqual(['resume', 'thread-1', 'NOTE-1'])
  })

  it('runs without the sandbox and the reviewer when the execution mode bypasses them', () => {
    expect(turnArgs({ model: null, bypassSandbox: true }, 'BTN-1')).toEqual(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', ...fallback, 'BTN-1'])
    expect(turnArgs({ model: null, bypassSandbox: false }, 'BTN-1', 'thread-1')).toEqual(['exec', '--json', '--approve-for-me', ...fallback, 'resume', 'thread-1', 'BTN-1'])
  })

  it('keeps the memory out, neither read nor written, when the start asks so', () => {
    const off = ['-c', 'features.memories=false', '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false']
    expect(turnArgs({ model: null, noMemory: true }, 'go on', 'thread-1')).toEqual(['exec', '--json', '--approve-for-me', ...fallback, ...off, 'resume', 'thread-1', 'go on'])
  })

  it('sets the window and compacts where Claude would with the same window', () => {
    const window = ['-c', 'model_context_window=250000', '-c', 'model_auto_compact_token_limit=218000']
    expect(turnArgs({ model: null, contextWindow: 250_000 }, 'BTN-1')).toEqual(['exec', '--json', '--approve-for-me', ...fallback, ...window, 'BTN-1'])
    expect(turnArgs({ model: null, contextWindow: 250_000 }, 'go on', 'thread-1')).toEqual(['exec', '--json', '--approve-for-me', ...fallback, ...window, 'resume', 'thread-1', 'go on'])
  })

  it("leaves the model's own window without one", () => {
    expect(turnArgs({ model: null }, 'BTN-1').join(' ')).not.toContain('model_context_window')
  })

  it('puts the model, the gateway servers and every other flag before resume', () => {
    const mcp = [{ name: 'huly', plugin: 'huly', url: 'http://127.0.0.1:4748/mcp/p/huly%40even-keel@a/huly' }]
    expect(turnArgs({ model: 'gpt-5.6-luna', mcp }, 'go on', 'thread-1')).toEqual([
      'exec',
      '--json',
      '--approve-for-me',
      ...fallback,
      '-m',
      'gpt-5.6-luna',
      '-c',
      'mcp_servers.plugin_huly_huly.url="http://127.0.0.1:4748/mcp/p/huly%40even-keel@a/huly"',
      'resume',
      'thread-1',
      'go on',
    ])
  })

  it('puts the plugin flags after the servers and before resume', () => {
    const plugins = ['-c', 'plugins.huly@ek-b.enabled=true']
    expect(turnArgs({ model: null }, 'go on', 'thread-1', plugins)).toEqual(['exec', '--json', '--approve-for-me', ...fallback, ...plugins, 'resume', 'thread-1', 'go on'])
  })
})
