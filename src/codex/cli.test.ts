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
    expect(turnArgs({}, 'BTN-1')).toEqual(['exec', '--json', '--approve-for-me', 'BTN-1'])
  })

  it('puts the model, the tracker and every other flag before resume', () => {
    const tracker = { name: 'huly', server: { command: 'npx' }, env: { HULY_URL: 'https://example.com' } }
    expect(turnArgs({ modelName: 'gpt-5.6-luna', tracker }, 'go on', 'thread-1')).toEqual([
      'exec',
      '--json',
      '--approve-for-me',
      '-m',
      'gpt-5.6-luna',
      '-c',
      'mcp_servers.huly.command="npx"',
      '-c',
      'mcp_servers.huly.env_vars=["HULY_URL"]',
      '-c',
      'shell_environment_policy.exclude=["HULY_URL"]',
      'resume',
      'thread-1',
      'go on',
    ])
  })
})
