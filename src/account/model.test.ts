import { describe, expect, it } from 'vitest'
import type { ActiveChain } from '../chain/dispatcher.js'
import type { AgentEntry } from '../sessions/agents.js'
import {
  accountId,
  extraFree,
  folderName,
  isApiKey,
  launchBlock,
  liveSessions,
  loginBlock,
  loginBlockNotice,
  loginCode,
  loginUrls,
  needsLogin,
  parseAuthStatus,
  parseCredentialTimes,
  removeProblem,
  secondFreeProblem,
  switchProblem,
  takesShared,
  withIdentity,
  type AccountEntry,
  type AccountView,
  type AccountStatus,
} from './model.js'
import { englishOf, textNotice, type Notice } from '../notice/notice.js'

const say = (notice: Notice | undefined) => (notice === undefined ? undefined : englishOf(notice))

const signedIn = (email: string | null = 'john.doe@example.com'): AccountStatus => ({
  loggedIn: true,
  authMethod: 'claude.ai',
  email,
  orgName: null,
  subscriptionType: 'max',
})

const entry = (patch: Partial<AccountEntry>): AccountEntry => ({
  key: 'global',
  name: null,
  global: true,
  agent: 'claude',
  status: signedIn(),
  error: null,
  loginExpiresAt: '2026-10-27T10:00:00.000Z',
  needsLogin: false,
  sessions: [],
  projects: [],
  removing: false,
  configPending: false,
  apiKey: false,
  limits: null,
  usage: { state: 'ok', reason: null, since: null },
  ...patch,
})

describe('API accounts', () => {
  const keyed = (authMethod: string): AccountStatus => ({ loggedIn: true, authMethod, email: null, orgName: null, subscriptionType: null })

  it('is an account that signs in with a key or a key helper, not with claude.ai', () => {
    expect(isApiKey(keyed('api_key'))).toBe(true)
    expect(isApiKey(keyed('api_key_helper'))).toBe(true)
    expect(isApiKey(signedIn())).toBe(false)
    expect(isApiKey(null)).toBe(false)
  })

  it('is named by its folder in place of the e-mail it has none of', () => {
    expect(withIdentity(keyed('api_key'), 'api-work').email).toBe('api-work')
    expect(withIdentity(signedIn(), 'work').email).toBe('john.doe@example.com')
    expect(withIdentity({ ...keyed('api_key'), loggedIn: false }, 'api-work').email).toBeNull()
  })
})

const view = (patch: Partial<AccountView>): AccountView => ({
  active: 'global',
  accounts: [entry({}), entry({ key: 'work', global: false, status: signedIn('jane.roe@example.com') })],
  login: null,
  loginBlock: null,
  apps: [],
  pool: [],
  missing: [],
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

describe('loginCode', () => {
  // `codex login --device-auth` of codex-cli 0.162.1, its format strings and colours as the binary has them.
  const codex = [
    '\u001b[94mWelcome to Codex [v\u001b[90m0.162.1\u001b[0m\u001b[94m]\u001b[0m',
    "\u001b[90mOpenAI's command-line coding agent\u001b[0m",
    '',
    'Follow these steps to sign in with ChatGPT using device code authorization:',
    '',
    '1. Open this link in your browser and sign in to your account',
    '   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m',
    '',
    '2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m',
    '   \u001b[94mK7QZ-4MXPT\u001b[0m',
    '',
    '\u001b[90mContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\u001b[0m',
    '',
  ].join('\n')

  it("takes Codex's one-time code from the line under its step", () => {
    expect(loginCode(codex)).toBe('K7QZ-4MXPT')
  })

  it("takes OpenCode's code from its Enter code line, ChatGPT's and Copilot's alike", () => {
    const output = ['┌  Add credential', '│', '●  Go to: https://github.com/login/device', '│', '●  Enter code: WDJB-MJHT', '│', '◒  Waiting for authorization...', ''].join('\r\n')
    expect(loginCode(output)).toBe('WDJB-MJHT')
  })

  it('waits for the line to end, so a code cut by a chunk is not taken', () => {
    expect(loginCode(codex.slice(0, codex.indexOf('4MXPT') + 2))).toBeNull()
  })

  it('finds nothing in output without a code', () => {
    expect(loginCode("Browser didn't open? Use the url below to sign in:\n\nhttps://claude.ai/oauth/authorize?code=true\n")).toBeNull()
    expect(loginCode(codex.slice(0, codex.indexOf('2. Enter')))).toBeNull()
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

  it('names a session resting between turns', () => {
    expect(liveSessions([agent({ name: 'ABC-5', resting: true, account: 'codex' })], 'codex')).toEqual(['ABC-5'])
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
  const chain = (paused: boolean, project = 'ABC'): ActiveChain => ({ project, current: null, paused, error: null })

  it('allows a sign-in with no chain or a paused one and every session idle or gone', () => {
    const agents = [
      agent({ name: 'ABC-1', status: 'idle' }),
      agent({ name: 'ABC-2', kind: 'background', status: 'idle', state: 'blocked' }),
      agent({ name: 'ABC-3', kind: 'background', status: 'idle', state: 'working' }),
      agent({ name: 'ABC-4', kind: 'background', status: 'busy', state: 'done' }),
      agent({ name: 'ABC-5', kind: 'background', status: 'busy', state: 'stopped' }),
    ]
    expect(loginBlock([], agents, 'global')).toBeNull()
    expect(loginBlock([chain(true), chain(true, 'XYZ')], agents, 'global')).toBeNull()
  })

  it('counts a session running a background command as busy', () => {
    const agents = [agent({ name: 'ABC-1', kind: 'background', status: 'shell', state: 'working' })]
    expect(loginBlock([], agents, 'global')?.sessions).toEqual([{ name: 'ABC-1', status: 'busy', waitingFor: null }])
  })

  it('names every running chain', () => {
    expect(loginBlock([chain(false), chain(true, 'DEF'), chain(false, 'XYZ')], [], 'global')).toEqual({ chains: ['ABC', 'XYZ'], sessions: [] })
    expect(say(loginBlockNotice({ chains: ['ABC', 'XYZ'], sessions: [] }))).toMatch(/ABC, XYZ/)
  })

  it('counts only the sessions of the active account', () => {
    const agents = [
      agent({ name: 'ABC-2', kind: 'background', status: 'busy', state: 'working', account: 'work' }),
      agent({ name: 'ABC-3', kind: 'background', status: 'busy', state: 'working' }),
    ]
    expect(loginBlock([], agents, 'work')?.sessions.map((session) => session.name)).toEqual(['ABC-2'])
    expect(loginBlock([], agents, 'global')?.sessions.map((session) => session.name)).toEqual(['ABC-3'])
  })

  it('names every session in the middle of a turn, with a task or without one', () => {
    const agents = [
      agent({ name: 'ABC-2', kind: 'background', status: 'busy', state: 'working' }),
      agent({ name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' }),
      agent({ sessionId: '12345678-0000-4000-8000-000000000009', status: 'busy' }),
      agent({ name: 'ABC-6', status: 'idle' }),
    ]
    expect(loginBlock([chain(true)], agents, 'global')).toEqual({
      chains: [],
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
    expect(say(loginBlockNotice({ chains: ['ABC'], sessions: [] }))).toBe(
      'claude: chain ABC is running; stop it before switching the account',
    )
    expect(
      say(
        loginBlockNotice({
          chains: [],
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
  const login = { agent: 'claude', target: 'global', startedAt: '2026-09-27T10:00:00Z', urls: [], deviceCode: null, output: '', error: null, codeSent: false }

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

  it('judges the folder it is given rather than the active one: a Codex session starts in its own', () => {
    const codex = entry({ key: 'codex', status: { ...signedIn(), loggedIn: false }, needsLogin: true })
    expect(say(launchBlock(view({ accounts: [entry({}), codex] }), 'codex'))).toMatch(/not signed in/)
    expect(launchBlock(view({ accounts: [entry({ needsLogin: true }), { ...codex, status: signedIn(), needsLogin: false }] }), 'codex')).toBeUndefined()
    expect(say(launchBlock(view({}), 'codex'))).toMatch(/gone/)
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

  it('refuses an unknown, active or unsigned account', () => {
    expect(say(switchProblem(view({}), 'nope'))).toMatch(/no account/)
    expect(say(switchProblem(view({}), 'global'))).toMatch(/already active/)
    const expired = view({ accounts: [entry({}), entry({ key: 'work', global: false, needsLogin: true })] })
    expect(say(switchProblem(expired, 'work'))).toMatch(/needs a login/)
  })

  it('is held neither by a running chain nor by busy sessions: a switch only picks the folder for new launches', () => {
    const busy = { chains: ['ABC'], sessions: [{ name: 'ABC-1', status: 'busy' as const, waitingFor: null }] }
    expect(switchProblem(view({ loginBlock: busy }), 'work')).toBeUndefined()
  })

  it('refuses an account whose folder waits to be removed', () => {
    const removing = view({ accounts: [entry({}), entry({ key: 'work', global: false, removing: true })] })
    expect(say(switchProblem(removing, 'work'))).toMatch(/removed/)
  })
})

describe('the Codex folders', () => {
  const codex = view({ accounts: [entry({}), entry({ key: 'codex', agent: 'codex' }), entry({ key: 'work', global: false, agent: 'codex' })] })

  it('takes the Even Keel role like a Claude folder', () => {
    expect(switchProblem(codex, 'codex')).toBeUndefined()
  })

  it("keeps Codex's own folder and lets an added one go", () => {
    expect(removeProblem(codex, 'codex')).toMatchObject({ code: 'account.codexHomeKept' })
    expect(removeProblem(codex, 'work')).toBeUndefined()
  })
})

describe('takesShared', () => {
  const shared = (provider: string, account: string) => ({ project: null, provider, account })

  it('gives the first added Codex account the shared entry while that names a folder that was never there', () => {
    const homes = [{ key: 'global', agent: 'claude' }, { key: 'work', agent: 'codex' }]
    expect(takesShared([shared('claude', 'global'), shared('codex', 'codex')], homes, 'codex')).toBe(true)
  })

  it('leaves a shared entry alone while its folder is there', () => {
    const homes = [{ key: 'codex', agent: 'codex' }, { key: 'work', agent: 'codex' }]
    expect(takesShared([shared('codex', 'codex')], homes, 'codex')).toBe(false)
  })

  it("does not count a project's own entry or another agent's folder of the same key", () => {
    const homes = [{ key: 'codex', agent: 'claude' }, { key: 'work', agent: 'codex' }]
    expect(takesShared([{ project: 'abc', provider: 'codex', account: 'work' }, shared('codex', 'codex')], homes, 'codex')).toBe(true)
  })

  it('takes the entry when the shared pool has none for the agent', () => {
    expect(takesShared([], [{ key: 'work', agent: 'claude' }], 'claude')).toBe(true)
  })
})

describe('free Codex accounts', () => {
  const free = (email: string): AccountStatus => ({ ...signedIn(email), authMethod: 'chatgpt', subscriptionType: 'free' })
  const plus = (email: string): AccountStatus => ({ ...signedIn(email), authMethod: 'chatgpt', subscriptionType: 'plus' })
  const codex = (key: string, status: AccountStatus) => entry({ key, global: key === 'codex', agent: 'codex', status })

  it('lets one free account work and any number of paid ones', () => {
    const accounts = [entry({}), codex('codex', free('john@example.com')), codex('work', plus('jane@example.com')), codex('team', plus('ci@example.com'))]
    expect(extraFree(accounts)).toEqual([])
    expect(secondFreeProblem(accounts, 'codex', plus('new@example.com'))).toBeUndefined()
    expect(secondFreeProblem(accounts, 'claude', { ...signedIn('new@example.com'), subscriptionType: 'free' })).toBeUndefined()
  })

  it('refuses to add a second free account, naming the one already on the free plan', () => {
    const accounts = [entry({}), codex('codex', free('john@example.com'))]
    const refused = secondFreeProblem(accounts, 'codex', free('jane@example.com'))
    expect(refused?.code).toBe('account.secondFree')
    expect(say(refused)).toMatch(/sign-in went through.*john@example\.com.*signed out and removed.*nothing was added.*paid/)
    expect(secondFreeProblem([entry({})], 'codex', free('jane@example.com'))).toBeUndefined()
  })

  it('says a free sign-in into the account already here is that same account', () => {
    const accounts = [entry({}), codex('codex', free('john@example.com'))]
    const refused = secondFreeProblem(accounts, 'codex', free('John@Example.com'))
    expect(refused?.code).toBe('account.sameFree')
    expect(say(refused)).toMatch(/john@example\.com.*already here.*nothing was added/)
  })

  it('holds every free account past the first in the folders\' order: no launch, no Even Keel role', () => {
    const accounts = [entry({}), codex('codex', free('john@example.com')), codex('work', free('jane@example.com'))]
    expect(extraFree(accounts)).toEqual(['work'])
    const held = view({ accounts })
    expect(say(launchBlock(held, 'work'))).toMatch(/second free Codex account next to john@example\.com/)
    expect(launchBlock(held, 'codex')).toBeUndefined()
    expect(say(switchProblem(held, 'work'))).toMatch(/second free/)
  })

  it('does not count a free account that is signed out', () => {
    expect(extraFree([codex('codex', { ...free('john@example.com'), loggedIn: false }), codex('work', free('jane@example.com'))])).toEqual([])
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
    expect(removeProblem(view({ active: 'work' }), 'global')).toMatchObject({ code: 'account.globalKept' })
    const login = { agent: 'claude', target: 'work', startedAt: '2026-09-27T10:00:00Z', urls: [], deviceCode: null, output: '', error: null, codeSent: false }
    expect(say(removeProblem(view({ login }), 'work'))).toMatch(/sign-in/)
  })

  it('keeps a folder an app still uses', () => {
    const apps = [{ app: 'vscode' as const, account: 'work', dir: 'C:\\work', error: null, sessions: [] }]
    expect(say(removeProblem(view({ apps }), 'work'))).toMatch(/VS Code uses/)
  })

  it('keeps a folder a pool entry names, the shared pool or a project', () => {
    expect(say(removeProblem(view({ pool: [{ project: null, provider: 'codex', account: 'work' }] }), 'work'))).toMatch(/shared settings/)
    const pool = [
      { project: 'ABC', provider: 'claude', account: 'work' },
      { project: 'XYZ', provider: 'codex', account: 'work' },
      { project: 'DEF', provider: 'claude', account: 'other' },
    ]
    expect(say(removeProblem(view({ pool }), 'work'))).toMatch(/projects ABC, XYZ/)
    expect(removeProblem(view({ pool }), 'other-work')).toMatchObject({ code: 'account.unknown' })
  })
})
