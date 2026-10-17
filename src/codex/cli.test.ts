import { describe, expect, it } from 'vitest'
import { parseLoginStatus, turnArgs } from './cli.js'

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
      'mcp_servers.huly.url="http://127.0.0.1:4748/mcp/p/huly%40even-keel@a/huly"',
      'resume',
      'thread-1',
      'go on',
    ])
  })
})
