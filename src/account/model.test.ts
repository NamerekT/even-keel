import { describe, expect, it } from 'vitest'
import type { ActiveChain } from '../chain/dispatcher.js'
import type { HulyTask, StatusCategory } from '../huly/model.js'
import { launchBlock, loginBlock, loginUrls, parseAuthStatus, type AccountView } from './model.js'

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
  const task = (id: string, category: StatusCategory): HulyTask => ({ id, title: id, status: { name: category, category }, blockedBy: [] })
  const tasks = [task('ABC-1', 'Won'), task('ABC-2', 'Active'), task('ABC-3', 'Lost')]

  it('allows a sign-in with no chain or a paused one and no live session', () => {
    expect(loginBlock(null, [], tasks)).toBeUndefined()
    expect(loginBlock(chain(true), [{ task: 'ABC-2', lamp: 'finished' }], tasks)).toBeUndefined()
  })

  it('refuses a sign-in while a chain is running', () => {
    expect(loginBlock(chain(false), [], tasks)).toMatch(/chain ABC is running/)
  })

  it('refuses a sign-in while a session on an open task is alive, even a stopped one', () => {
    for (const lamp of ['working', 'waiting', 'error', 'limit'] as const) {
      expect(loginBlock(chain(true), [{ task: 'ABC-2', lamp }], tasks), lamp).toMatch(/ABC-2/)
    }
  })

  it('ignores sessions left alive on closed tasks', () => {
    const sessions = [
      { task: 'ABC-1', lamp: 'waiting' as const },
      { task: 'ABC-3', lamp: 'working' as const },
    ]
    expect(loginBlock(null, sessions, tasks)).toBeUndefined()
  })

  it('counts a session on a task it does not know as open', () => {
    expect(loginBlock(null, [{ task: 'ABC-9', lamp: 'waiting' }], tasks)).toMatch(/ABC-9/)
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
