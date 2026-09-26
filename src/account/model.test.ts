import { describe, expect, it } from 'vitest'
import type { ActiveChain } from '../chain/dispatcher.js'
import type { AgentEntry } from '../sessions/agents.js'
import { launchBlock, loginBlock, loginBlockMessage, loginUrls, parseAuthStatus, type AccountView } from './model.js'

describe('parseAuthStatus', () => {
  it('reads a signed-in account', () => {
    const text = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'john.doe@example.com',
      orgId: '00000000-0000-4000-8000-000000000000',
      orgName: 'Example Org',
      subscriptionType: 'max',
    })
    expect(parseAuthStatus(text)).toEqual({
      loggedIn: true,
      authMethod: 'claude.ai',
      email: 'john.doe@example.com',
      orgName: 'Example Org',
      subscriptionType: 'max',
    })
  })

  it('reads a signed-out answer with the fields missing', () => {
    expect(parseAuthStatus('{\n  "loggedIn": false,\n  "authMethod": "none"\n}\n')).toEqual({
      loggedIn: false,
      authMethod: 'none',
      email: null,
      orgName: null,
      subscriptionType: null,
    })
  })

  it('refuses an answer that does not say whether it is signed in', () => {
    expect(() => parseAuthStatus('{"email":"john.doe@example.com"}')).toThrow(/loggedIn/)
    expect(() => parseAuthStatus('Not logged in')).toThrow(/auth status/)
    expect(() => parseAuthStatus('[]')).toThrow(/auth status/)
  })
})

describe('loginUrls', () => {
  it('picks the sign-in links out of the CLI output, without colours and in order', () => {
    const output = [
      '\u001b[2mOpening browser to sign in…\u001b[22m',
      'Browser didn\'t open? Use the url below to sign in:',
      '',
      '\u001b[36mhttps://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz\u001b[39m',
      'or https://example.com/manual.',
      'https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz',
    ].join('\r\n')
    expect(loginUrls(output)).toEqual([
      'https://claude.ai/oauth/authorize?code=true&client_id=abc&state=xyz',
      'https://example.com/manual',
    ])
  })

  it('finds nothing in output without links', () => {
    expect(loginUrls('Waiting for the browser…')).toEqual([])
  })
})

describe('loginBlock', () => {
  const chain = (paused: boolean): ActiveChain => ({ project: 'ABC', current: null, paused, error: null })
  const agent = (patch: Partial<AgentEntry>): AgentEntry => ({
    cwd: 'C:\\repos\\example',
    kind: 'interactive',
    startedAt: 0,
    sessionId: '00000000-0000-4000-8000-000000000001',
    ...patch,
  })

  it('allows a sign-in with no chain or a paused one and every session idle or gone', () => {
    const agents = [
      agent({ name: 'ABC-1', status: 'idle' }),
      agent({ name: 'ABC-2', kind: 'background', status: 'idle', state: 'blocked' }),
      agent({ name: 'ABC-3', kind: 'background', status: 'idle', state: 'working' }),
      agent({ name: 'ABC-4', kind: 'background', status: 'busy', state: 'done' }),
      agent({ name: 'ABC-5', kind: 'background', status: 'busy', state: 'stopped' }),
    ]
    expect(loginBlock(null, agents)).toBeNull()
    expect(loginBlock(chain(true), agents)).toBeNull()
  })

  it('names a running chain', () => {
    expect(loginBlock(chain(false), [])).toEqual({ chain: 'ABC', sessions: [] })
  })

  it('names every session in the middle of a turn, with a task or without one', () => {
    const agents = [
      agent({ name: 'ABC-2', kind: 'background', status: 'busy', state: 'working' }),
      agent({ name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' }),
      agent({ sessionId: '12345678-0000-4000-8000-000000000009', status: 'busy' }),
      agent({ name: 'ABC-6', status: 'idle' }),
    ]
    expect(loginBlock(chain(true), agents)).toEqual({
      chain: null,
      sessions: [
        { name: 'ABC-2', status: 'busy', waitingFor: null },
        { name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' },
        { name: '12345678', status: 'busy', waitingFor: null },
      ],
    })
  })
})

describe('loginBlockMessage', () => {
  it('names the running chain first, then the busy sessions', () => {
    expect(loginBlockMessage({ chain: 'ABC', sessions: [] })).toBe(
      'claude: chain ABC is running; pause it before switching the account',
    )
    expect(
      loginBlockMessage({
        chain: null,
        sessions: [
          { name: 'ABC-2', status: 'busy', waitingFor: null },
          { name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' },
        ],
      }),
    ).toBe('claude: sessions are in the middle of a turn (ABC-2, Scratch notes); switch the account once they finish')
  })
})

describe('launchBlock', () => {
  const view = (patch: Partial<AccountView>): AccountView => ({ status: null, error: null, login: null, loginBlock: null, ...patch })
  const account = (loggedIn: boolean) => ({ loggedIn, authMethod: null, email: null, orgName: null, subscriptionType: null })

  it('lets sessions start when signed in or when the account is not known yet', () => {
    expect(launchBlock(view({ status: account(true) }))).toBeUndefined()
    expect(launchBlock(view({ status: null, error: 'claude: auth status timed out' }))).toBeUndefined()
  })

  it('holds sessions back when signed out', () => {
    expect(launchBlock(view({ status: account(false) }))).toMatch(/not signed in/)
  })

  it('holds sessions back while a sign-in is running, but not after it failed', () => {
    const login = { startedAt: '2026-09-27T10:00:00Z', urls: [], output: '', error: null, codeSent: false }
    expect(launchBlock(view({ status: account(true), login }))).toMatch(/sign-in is in progress/)
    expect(launchBlock(view({ status: account(true), login: { ...login, error: 'exited with code 1' } }))).toBeUndefined()
  })
})
