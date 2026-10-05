import { describe, expect, it } from 'vitest'
import type { ActiveChain } from '../chain/dispatcher.js'
import type { AgentEntry } from '../sessions/agents.js'
import {
  accountId,
  folderName,
  launchBlock,
  liveSessions,
  loginBlock,
  loginBlockNotice,
  loginUrls,
  needsLogin,
  parseAuthStatus,
  parseCredentialTimes,
  removeProblem,
  switchProblem,
  type AccountEntry,
  type AccountView,
  type ClaudeAccount,
} from './model.js'
import { englishOf, textNotice, type Notice } from '../notice/notice.js'

const say = (notice: Notice | undefined) => (notice === undefined ? undefined : englishOf(notice))

const signedIn = (email: string | null = 'john.doe@example.com'): ClaudeAccount => ({
  loggedIn: true,
  authMethod: 'claude.ai',
  email,
  orgName: null,
  subscriptionType: 'max',
})

const entry = (patch: Partial<AccountEntry>): AccountEntry => ({
  key: 'global',
  global: true,
  status: signedIn(),
  error: null,
  loginExpiresAt: '2026-10-27T10:00:00.000Z',
  needsLogin: false,
  sessions: [],
  removing: false,
  configPending: false,
  limits: null,
  usage: { state: 'ok', reason: null, since: null },
  ...patch,
})

const view = (patch: Partial<AccountView>): AccountView => ({
  active: 'global',
  accounts: [entry({}), entry({ key: 'work', global: false, status: signedIn('jane.roe@example.com') })],
  login: null,
  loginBlock: null,
  apps: [],
  ...patch,
})

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

const agent = (patch: Partial<AgentEntry>): AgentEntry => ({
  cwd: 'C:\\repos\\example',
  kind: 'interactive',
  startedAt: 0,
  sessionId: '00000000-0000-4000-8000-000000000001',
  ...patch,
})

describe('liveSessions', () => {
  it('names the sessions of the account whose process is alive, whatever their state', () => {
    const agents = [
      agent({ name: 'ABC-1', kind: 'background', state: 'blocked', pid: 101, account: 'work' }),
      agent({ name: 'ABC-2', kind: 'background', state: 'done', pid: 102, account: 'work' }),
      agent({ sessionId: '12345678-0000-4000-8000-000000000009', pid: 103, account: 'work' }),
      agent({ name: 'ABC-4', pid: 104 }),
    ]
    expect(liveSessions(agents, 'work')).toEqual(['ABC-1', 'ABC-2', '12345678'])
    expect(liveSessions(agents, 'global')).toEqual(['ABC-4'])
  })

  it('ignores records left behind by dead processes, even blocked or working ones', () => {
    const agents = [
      agent({ name: 'ABC-1', kind: 'background', state: 'blocked', account: 'work' }),
      agent({ name: 'ABC-2', kind: 'background', state: 'working', account: 'work' }),
    ]
    expect(liveSessions(agents, 'work')).toEqual([])
  })
})

describe('loginBlock', () => {
  const chain = (paused: boolean): ActiveChain => ({ project: 'ABC', current: null, paused, error: null })

  it('allows a sign-in with no chain or a paused one and every session idle or gone', () => {
    const agents = [
      agent({ name: 'ABC-1', status: 'idle' }),
      agent({ name: 'ABC-2', kind: 'background', status: 'idle', state: 'blocked' }),
      agent({ name: 'ABC-3', kind: 'background', status: 'idle', state: 'working' }),
      agent({ name: 'ABC-4', kind: 'background', status: 'busy', state: 'done' }),
      agent({ name: 'ABC-5', kind: 'background', status: 'busy', state: 'stopped' }),
    ]
    expect(loginBlock(null, agents, 'global')).toBeNull()
    expect(loginBlock(chain(true), agents, 'global')).toBeNull()
  })

  it('counts a session running a background command as busy', () => {
    const agents = [agent({ name: 'ABC-1', kind: 'background', status: 'shell', state: 'working' })]
    expect(loginBlock(null, agents, 'global')?.sessions).toEqual([{ name: 'ABC-1', status: 'busy', waitingFor: null }])
  })

  it('names a running chain', () => {
    expect(loginBlock(chain(false), [], 'global')).toEqual({ chain: 'ABC', sessions: [] })
  })

  it('counts only the sessions of the active account', () => {
    const agents = [
      agent({ name: 'ABC-2', kind: 'background', status: 'busy', state: 'working', account: 'work' }),
      agent({ name: 'ABC-3', kind: 'background', status: 'busy', state: 'working' }),
    ]
    expect(loginBlock(null, agents, 'work')?.sessions.map((session) => session.name)).toEqual(['ABC-2'])
    expect(loginBlock(null, agents, 'global')?.sessions.map((session) => session.name)).toEqual(['ABC-3'])
  })

  it('names every session in the middle of a turn, with a task or without one', () => {
    const agents = [
      agent({ name: 'ABC-2', kind: 'background', status: 'busy', state: 'working' }),
      agent({ name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' }),
      agent({ sessionId: '12345678-0000-4000-8000-000000000009', status: 'busy' }),
      agent({ name: 'ABC-6', status: 'idle' }),
    ]
    expect(loginBlock(chain(true), agents, 'global')).toEqual({
      chain: null,
      sessions: [
        { name: 'ABC-2', status: 'busy', waitingFor: null },
        { name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' },
        { name: '12345678', status: 'busy', waitingFor: null },
      ],
    })
  })
})

describe('loginBlockNotice', () => {
  it('names the running chain first, then the busy sessions', () => {
    expect(say(loginBlockNotice({ chain: 'ABC', sessions: [] }))).toBe(
      'claude: chain ABC is running; pause it before switching the account',
    )
    expect(
      say(
        loginBlockNotice({
          chain: null,
          sessions: [
            { name: 'ABC-2', status: 'busy', waitingFor: null },
            { name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' },
          ],
        }),
      ),
    ).toBe('claude: sessions are in the middle of a turn (ABC-2, Scratch notes); switch the account once they finish')
  })
})

describe('launchBlock', () => {
  const login = { target: 'global', startedAt: '2026-09-27T10:00:00Z', urls: [], output: '', error: null, codeSent: false }

  it('lets sessions start when the active account is signed in or not known yet', () => {
    expect(launchBlock(view({}))).toBeUndefined()
    expect(launchBlock(view({ accounts: [entry({ status: null, error: textNotice('claude: auth status timed out') })] }))).toBeUndefined()
  })

  it('holds sessions back when the active account is signed out or its login ran out', () => {
    expect(say(launchBlock(view({ accounts: [entry({ status: { ...signedIn(), loggedIn: false }, needsLogin: true })] })))).toMatch(
      /not signed in/,
    )
    expect(say(launchBlock(view({ accounts: [entry({ needsLogin: true })] })))).toMatch(/login of john\.doe@example\.com has run out/)
  })

  it('holds sessions back when the active folder is gone', () => {
    expect(say(launchBlock(view({ active: 'gone' })))).toMatch(/gone/)
  })

  it('holds sessions back only while the active account itself signs in, and not after it failed', () => {
    expect(say(launchBlock(view({ login })))).toMatch(/sign-in is in progress/)
    expect(launchBlock(view({ login: { ...login, error: textNotice('exited with code 1') } }))).toBeUndefined()
    expect(launchBlock(view({ login: { ...login, target: 'work' } }))).toBeUndefined()
    expect(launchBlock(view({ login: { ...login, target: null } }))).toBeUndefined()
  })
})

describe('parseCredentialTimes', () => {
  it('reads only the expiry moments of the claude.ai sign-in', () => {
    const text = JSON.stringify({
      claudeAiOauth: { accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt: 1790586688467, refreshTokenExpiresAt: 1793080369467 },
      mcpOAuth: { example: { expiresAt: 1 } },
    })
    expect(parseCredentialTimes(text)).toEqual({ accessExpiresAt: 1790586688467, loginExpiresAt: 1793080369467, erased: false })
  })

  it('sees a sign-in the CLI erased after the server refused it', () => {
    const text = JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } })
    expect(parseCredentialTimes(text)).toEqual({ accessExpiresAt: 0, loginExpiresAt: null, erased: true })
  })

  it('knows nothing from a missing or broken file', () => {
    const none = { accessExpiresAt: null, loginExpiresAt: null, erased: false }
    expect(parseCredentialTimes(undefined)).toEqual(none)
    expect(parseCredentialTimes('{')).toEqual(none)
    expect(parseCredentialTimes('{"mcpOAuth":{}}')).toEqual(none)
  })
})

describe('needsLogin', () => {
  const now = new Date('2026-09-28T10:00:00.000Z')
  const times = { accessExpiresAt: null, loginExpiresAt: Date.parse('2026-10-27T10:00:00.000Z'), erased: false }

  it('asks for a login when signed out, erased or run out', () => {
    expect(needsLogin({ ...signedIn(), loggedIn: false }, times, now)).toBe(true)
    expect(needsLogin(signedIn(), { ...times, erased: true }, now)).toBe(true)
    expect(needsLogin(signedIn(), { ...times, loginExpiresAt: Date.parse('2026-09-28T09:00:00.000Z') }, now)).toBe(true)
  })

  it('does not while the login lasts or nothing is known yet', () => {
    expect(needsLogin(signedIn(), times, now)).toBe(false)
    expect(needsLogin(null, { accessExpiresAt: null, loginExpiresAt: null, erased: false }, now)).toBe(false)
  })
})

describe('folderName', () => {
  it('names the folder after the part of the e-mail before @', () => {
    expect(folderName('John.Doe+claude@example.com', [])).toBe('john.doe-claude')
  })

  it('never takes a name in use or the name of the global account', () => {
    expect(folderName('john@example.com', ['john', 'john-2'])).toBe('john-3')
    expect(folderName('global@example.com', [])).toBe('global-2')
    expect(folderName(null, [])).toBe('account')
  })
})

describe('accountId', () => {
  it('ties the e-mail to its folder, so the same e-mail elsewhere is another account', () => {
    expect(accountId('work', 'jane@example.com')).toBe('work/jane@example.com')
    expect(accountId('work', null)).toBeNull()
  })
})

describe('switchProblem', () => {
  it('lets an idle page switch to a signed-in account', () => {
    expect(switchProblem(view({}), 'work')).toBeUndefined()
  })

  it('refuses an unknown, active or unsigned account and a blocked switch', () => {
    expect(say(switchProblem(view({}), 'nope'))).toMatch(/no account/)
    expect(say(switchProblem(view({}), 'global'))).toMatch(/already active/)
    const expired = view({ accounts: [entry({}), entry({ key: 'work', global: false, needsLogin: true })] })
    expect(say(switchProblem(expired, 'work'))).toMatch(/needs a login/)
    expect(say(switchProblem(view({ loginBlock: { chain: 'ABC', sessions: [] } }), 'work'))).toMatch(/chain ABC is running/)
  })

  it('refuses an account whose folder waits to be removed', () => {
    const removing = view({ accounts: [entry({}), entry({ key: 'work', global: false, removing: true })] })
    expect(say(switchProblem(removing, 'work'))).toMatch(/removed/)
  })
})

describe('removeProblem', () => {
  it('lets an idle account folder go', () => {
    expect(removeProblem(view({}), 'work')).toBeUndefined()
  })

  it('lets a folder with unfinished sessions go once they are over', () => {
    expect(removeProblem(view({ accounts: [entry({}), entry({ key: 'work', global: false, sessions: ['ABC-1', 'ABC-2'] })] }), 'work')).toBeUndefined()
  })

  it('keeps the active and the global folder', () => {
    expect(say(removeProblem(view({ active: 'work' }), 'work'))).toMatch(/active/)
    expect(say(removeProblem(view({ active: 'work' }), 'global'))).toMatch(/global/)
    const login = { target: 'work', startedAt: '2026-09-27T10:00:00Z', urls: [], output: '', error: null, codeSent: false }
    expect(say(removeProblem(view({ login }), 'work'))).toMatch(/sign-in/)
  })

  it('keeps a folder an app still uses', () => {
    const apps = [{ app: 'vscode' as const, account: 'work', dir: 'C:\\work', error: null, sessions: [] }]
    expect(say(removeProblem(view({ apps }), 'work'))).toMatch(/VS Code uses/)
  })
})
