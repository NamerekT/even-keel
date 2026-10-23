import { describe, expect, it } from 'vitest'
import { listedModels, parseLoginStatus, parseWriteAnswer, turnArgs, writeArgs } from './cli.js'

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

  it('does without a readable token', () => {
    expect(parseLoginStatus('Logged in using ChatGPT', '{"tokens":{"id_token":"broken"}}')).toMatchObject({ loggedIn: true, email: null, subscriptionType: null })
  })

  it('refuses output it does not know', () => {
    expect(() => parseLoginStatus('Error: something else', undefined)).toThrow(/neither/)
  })
})

describe('turnArgs', () => {
  it('starts a session in the chain mode with the JSON stream', () => {
    expect(turnArgs({ model: null }, 'BTN-1')).toEqual(['exec', '--json', '--approve-for-me', 'BTN-1'])
  })

  it('runs without the sandbox and the reviewer when the execution mode bypasses them', () => {
    expect(turnArgs({ model: null, bypassSandbox: true }, 'BTN-1')).toEqual(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', 'BTN-1'])
    expect(turnArgs({ model: null, bypassSandbox: false }, 'BTN-1', 'thread-1')).toEqual(['exec', '--json', '--approve-for-me', 'resume', 'thread-1', 'BTN-1'])
  })

  it('puts the model, the gateway servers and every other flag before resume', () => {
    const mcp = [{ name: 'huly', plugin: 'huly', url: 'http://127.0.0.1:4748/mcp/p/huly%40even-keel@a/huly' }]
    expect(turnArgs({ model: 'gpt-5.6-luna', mcp }, 'go on', 'thread-1')).toEqual([
      'exec',
      '--json',
      '--approve-for-me',
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
    expect(turnArgs({ model: null }, 'go on', 'thread-1', plugins)).toEqual(['exec', '--json', '--approve-for-me', ...plugins, 'resume', 'thread-1', 'go on'])
  })
})
