import { describe, expect, it } from 'vitest'
import type { AccountEntry } from '../../src/account/model.js'
import type { MachineSignIn } from '../../src/state.js'
import { folderWay, fullSignIn, gapCommand, hubSessionsOnly, loginAccess, machineGaps, machineLogin, machineLoginFacts, machineMarks, machineSend, machineTokens } from './machineSignIn.js'

const hub = (patch: Partial<AccountEntry> = {}): AccountEntry => ({
  key: 'john.doe@example.com', name: null, global: false, agent: 'claude',
  status: { loggedIn: true, authMethod: 'claude.ai', email: 'John.Doe@example.com', orgName: null, subscriptionType: 'max' },
  error: null, loginExpiresAt: null, needsLogin: false, sessions: [], projects: [], removing: false, configPending: false, apiKey: false,
  limits: null, usage: { state: 'ok', reason: null, since: null },
  ...patch,
} as AccountEntry)

const machine = (patch: Partial<MachineSignIn> = {}): MachineSignIn => ({
  machine: 'machine-1', name: 'Example laptop', online: true, accounts: [], login: null, missing: [], ...patch,
})

describe('a hub account on the machines elsewhere', () => {
  it('names each machine where the account is not signed in, its own signed-out folder if it has one', () => {
    const machines = [
      machine(),
      machine({ machine: 'machine-2', name: 'Example desktop', online: false, accounts: [{ key: 'work', agent: 'claude', email: 'john.doe@example.com', signedIn: false }] }),
      machine({ machine: 'machine-3', accounts: [{ key: 'other', agent: 'claude', email: 'john.doe@example.com', signedIn: true }] }),
      machine({ machine: 'machine-4', accounts: [{ key: 'john.doe@example.com', agent: 'claude', email: null, signedIn: false }], missing: ['claude'] }),
      machine({ machine: 'machine-5', accounts: [{ key: 'codex', agent: 'codex', email: 'john.doe@example.com', signedIn: true }] }),
    ]
    expect(machineGaps(hub(), machines)).toEqual([
      { machine: 'machine-1', name: 'Example laptop', online: true, noCli: false },
      { machine: 'machine-2', name: 'Example desktop', online: false, account: 'work', noCli: false },
      { machine: 'machine-4', name: 'Example laptop', online: true, account: 'john.doe@example.com', noCli: true },
      { machine: 'machine-5', name: 'Example laptop', online: true, noCli: false },
    ])
  })

  it("offers the machine's CLI folder not added when it is signed in as the same account, and adds it with no sign-in (BTN-1568)", () => {
    const globals = [{ key: 'global', agent: 'claude', email: 'john.doe@example.com' }, { key: 'codex', agent: 'codex', email: 'john.doe@example.com' }]
    const [gap] = machineGaps(hub(), [machine({ globals })])
    expect(gap).toEqual({ machine: 'machine-1', name: 'Example laptop', online: true, global: 'global', noCli: false })
    expect(gapCommand('claude', gap!)).toEqual(['machines/useGlobal', { machine: 'machine-1', agent: 'claude' }])
    const other = [{ key: 'global', agent: 'claude', email: 'jane.roe@example.com' }]
    const [plain] = machineGaps(hub(), [machine({ globals: other })])
    expect(plain).toEqual({ machine: 'machine-1', name: 'Example laptop', online: true, noCli: false })
    expect(gapCommand('claude', plain!)).toEqual(['machines/login', { machine: 'machine-1', agent: 'claude' }])
    expect(gapCommand('claude', { ...plain!, account: 'work' })).toEqual(['machines/login', { machine: 'machine-1', agent: 'claude', account: 'work' }])
  })

  it('offers nothing for an account signed out on the hub, a key, a cloud, a long token, or with no machines', () => {
    const machines = [machine()]
    expect(machineGaps(hub({ status: { loggedIn: false, authMethod: null, email: 'john.doe@example.com', orgName: null, subscriptionType: null } }), machines)).toEqual([])
    expect(machineGaps(hub({ apiKey: true }), machines)).toEqual([])
    expect(machineGaps(hub({ cloud: { cloud: 'bedrock' } as unknown as AccountEntry['cloud'] }), machines)).toEqual([])
    expect(machineGaps(hub({ longToken: { until: null } }), machines)).toEqual([])
    expect(machineGaps(hub(), undefined)).toEqual([])
  })

  it('names the machines that run the account on a long token, and none where a full sign-in is there too (BTN-1002)', () => {
    const onToken = { key: 'token', agent: 'claude', email: 'john.doe@example.com', signedIn: true, longToken: true as const }
    const full = { key: 'full', agent: 'claude', email: 'john.doe@example.com', signedIn: true }
    const machines = [
      machine({ accounts: [onToken] }),
      machine({ machine: 'machine-2', accounts: [onToken, full] }),
      machine({ machine: 'machine-3', accounts: [{ ...onToken, email: 'jane.roe@example.com' }] }),
      machine({ machine: 'machine-4', accounts: [{ ...onToken, signedIn: false }] }),
    ]
    expect(machineTokens(hub(), machines)).toEqual([{ machine: 'machine-1', name: 'Example laptop', sessionsOnly: false }])
    expect(machineGaps(hub(), machines).map((gap) => gap.machine)).toEqual(['machine-3', 'machine-4'])
  })

  it("says which machines' tokens nobody polls for, under a hub folder signed out too (BTN-1266)", () => {
    const alone = { key: 'token', agent: 'claude', email: 'john.doe@example.com', signedIn: true, longToken: true as const, sessionsOnly: true as const }
    const signedOut = hub({ needsLogin: true, status: { loggedIn: false, authMethod: null, email: null, orgName: null, subscriptionType: null }, lastEmail: 'john.doe@example.com' })
    expect(machineTokens(signedOut, [machine({ accounts: [alone] })])).toEqual([{ machine: 'machine-1', name: 'Example laptop', sessionsOnly: true }])
  })

  it('marks a hub long-token folder while no Claude folder of the hub is on a full sign-in (BTN-1266)', () => {
    const token = hub({ key: 'token', status: { loggedIn: true, authMethod: 'oauth_token', email: null, orgName: null, subscriptionType: null }, longToken: { until: null } })
    expect(hubSessionsOnly(token, [token])).toBe(true)
    expect(hubSessionsOnly(token, [token, hub({ needsLogin: true })])).toBe(true)
    expect(hubSessionsOnly(token, [token, hub({ agent: 'codex' })])).toBe(true)
    expect(hubSessionsOnly(token, [token, hub()])).toBe(false)
    expect(hubSessionsOnly(hub(), [hub()])).toBe(false)
  })
})

describe("the machines column of a hub account (BTN-1309)", () => {
  const signed = (patch: Partial<MachineSignIn['accounts'][number]> = {}) => ({ key: 'work', agent: 'claude', email: 'john.doe@example.com', signedIn: true, ...patch })

  it('names each machine the account is on: signed in, on a long token only, or its folder signed out there', () => {
    const machines = [
      machine({ accounts: [signed()] }),
      machine({ machine: 'machine-2', name: 'Example desktop', accounts: [signed({ longToken: true })] }),
      machine({ machine: 'machine-3', name: 'Example node', online: false, accounts: [signed({ key: 'old', signedIn: false })] }),
      machine({ machine: 'machine-4', accounts: [signed({ longToken: true }), signed({ key: 'full' })] }),
      machine({ machine: 'machine-5', accounts: [signed({ email: 'jane.roe@example.com' }), signed({ agent: 'codex' })] }),
      machine({ machine: 'machine-6' }),
    ]
    expect(machineMarks(hub(), [hub()], machines)).toEqual([
      { machine: 'machine-1', name: 'Example laptop', online: true, kind: 'in', sessionsOnly: false },
      { machine: 'machine-2', name: 'Example desktop', online: true, kind: 'token', sessionsOnly: false },
      { machine: 'machine-3', name: 'Example node', online: false, kind: 'out', account: 'old', sessionsOnly: false },
      { machine: 'machine-4', name: 'Example laptop', online: true, kind: 'in', sessionsOnly: false },
    ])
  })

  it("takes a signed-out folder of the hub's key whose e-mail the machine does not know", () => {
    const machines = [machine({ accounts: [{ key: 'john.doe@example.com', agent: 'claude', email: null, signedIn: false }] })]
    expect(machineMarks(hub(), [hub()], machines).map((mark) => [mark.kind, mark.account])).toEqual([['out', 'john.doe@example.com']])
  })

  it('says a token nobody polls for, and knows a signed-out hub folder by its last e-mail (BTN-1266)', () => {
    const signedOut = hub({ needsLogin: true, status: { loggedIn: false, authMethod: null, email: null, orgName: null, subscriptionType: null }, lastEmail: 'john.doe@example.com' })
    const machines = [machine({ accounts: [signed({ longToken: true, sessionsOnly: true })] })]
    expect(machineMarks(signedOut, [signedOut], machines).map((mark) => [mark.kind, mark.sessionsOnly])).toEqual([['token', true]])
  })

  it('marks nothing for a key, a cloud or an unknown e-mail, nor under a hub long token beside its full sign-in', () => {
    const machines = [machine({ accounts: [signed()] })]
    expect(machineMarks(hub({ apiKey: true }), [], machines)).toEqual([])
    expect(machineMarks(hub({ status: null }), [], machines)).toEqual([])
    const token = hub({ key: 'token', longToken: { until: null } })
    expect(machineMarks(token, [token, hub()], machines)).toEqual([])
    expect(machineMarks(token, [token], machines)).toHaveLength(1)
    expect(machineMarks(hub(), [hub()], undefined)).toEqual([])
  })
})

describe('signing in on the hub and on a machine', () => {
  it("signs in fully on the hub: again in the hub's folder of the e-mail, else in a new one (BTN-1266)", () => {
    const signedOut = hub({ needsLogin: true, status: null, lastEmail: 'john.doe@example.com' })
    const token = hub({ key: 'token', status: null, longToken: { until: null } })
    expect(fullSignIn('JOHN.DOE@example.com', [token, signedOut])).toEqual(['account/renew', { account: 'john.doe@example.com' }])
    expect(fullSignIn(null, [token, signedOut])).toEqual(['account/add', { agent: 'claude' }])
    expect(fullSignIn('jane.roe@example.com', [signedOut])).toEqual(['account/add', { agent: 'claude' }])
  })

  it("finds the machine's sign-in under way and sends its steps to that machine", async () => {
    const login = { agent: 'claude', target: null, startedAt: '2026-11-17T10:00:00.000Z', urls: [], deviceCode: null, output: '', error: null, codeSent: false }
    expect(machineLogin([machine(), machine({ machine: 'machine-2', login })])?.machine).toBe('machine-2')
    expect(machineLogin([machine()])).toBeUndefined()

    const sent: [string, Record<string, unknown> | undefined][] = []
    const send = machineSend('machine-2', async (name, body) => {
      sent.push([name, body])
      return true
    })
    await send('account/code', { code: 'one-time-code' })
    await send('account/cancel')
    await send('account/renew', { account: 'work' })
    await send('account/add', { agent: 'codex', method: 'device' })
    expect(sent).toEqual([
      ['machines/code', { machine: 'machine-2', code: 'one-time-code' }],
      ['machines/cancel', { machine: 'machine-2' }],
      ['machines/login', { machine: 'machine-2', account: 'work' }],
      ['machines/login', { machine: 'machine-2', agent: 'codex', method: 'device' }],
    ])
  })
})

describe("a machine's signed-out folder (BTN-1585)", () => {
  const folder = (patch: Partial<MachineSignIn['accounts'][number]> = {}) => ({ key: 'work', agent: 'codex', email: null, signedIn: false, ...patch })

  it('signs a subscription folder in through a browser, known by the e-mail it last had', () => {
    expect(folderWay(folder({ email: 'john.doe@example.com' }), [])).toBe('subscription')
  })

  it('gives a key, a cloud or a long token no browser sign-in: by what the machine tells or by the hub folder of the same key', () => {
    expect(folderWay(folder({ paysPerToken: true, email: 'john.doe@example.com' }), [])).toBe('key')
    expect(folderWay(folder({ longToken: true, email: 'john.doe@example.com' }), [])).toBe('token')
    expect(folderWay(folder(), [hub({ key: 'work', agent: 'codex', apiKey: true, status: null })])).toBe('key')
    expect(folderWay(folder({ agent: 'claude' }), [hub({ key: 'work', cloud: { cloud: 'bedrock' } as AccountEntry['cloud'] })])).toBe('key')
    expect(folderWay(folder({ agent: 'claude' }), [hub({ key: 'work', longToken: { until: null } })])).toBe('token')
  })

  it("asks how a folder signs in when neither the machine nor the hub tells: no e-mail, no hub folder of the key's kind", () => {
    expect(folderWay(folder(), [])).toBe('unknown')
    expect(folderWay(folder(), [hub({ key: 'work', agent: 'claude', apiKey: true })])).toBe('unknown')
  })
})

describe('what a sign-in on a machine names (BTN-1585)', () => {
  const login = (patch: Partial<NonNullable<MachineSignIn['login']>> = {}): NonNullable<MachineSignIn['login']> =>
    ({ agent: 'codex', target: 'work', startedAt: '2026-11-17T10:00:00.000Z', urls: [], deviceCode: null, output: '', error: null, codeSent: false, ...patch })

  it("names the provider by the agent and its way: Claude's subscription, ChatGPT, GitHub", () => {
    expect(loginAccess('claude')).toBe('claudeSubscription')
    expect(loginAccess('codex')).toBe('chatgpt')
    expect(loginAccess('opencode', 'chatgpt')).toBe('chatgpt')
    expect(loginAccess('opencode', 'none')).toBe('zen')
    expect(loginAccess('copilot')).toBe('github')
  })

  it("names the folder, its e-mail, and whether the chain's tasks there take it: the machine's own launch account or a hub folder of a project", () => {
    const accounts = [{ key: 'work', agent: 'codex', email: 'john.doe@example.com', signedIn: false }, { key: 'spare', agent: 'codex', email: null, signedIn: false }]
    const on = machine({ login: login(), accounts, active: 'spare' })
    expect(machineLoginFacts(on, [])).toEqual({ access: 'chatgpt', folder: 'work', email: 'john.doe@example.com', used: false })
    const used = hub({ key: 'hub-work', agent: 'codex', status: { loggedIn: true, authMethod: 'chatgpt', email: 'john.doe@example.com', orgName: null, subscriptionType: null }, projects: ['p1'] })
    expect(machineLoginFacts(on, [used])?.used).toBe(true)
    expect(machineLoginFacts(machine({ login: login({ target: 'spare' }), accounts, active: 'spare' }), [])?.used).toBe(true)
    expect(machineLoginFacts(machine({ login: login({ target: null }), accounts }), [used])).toEqual({ access: 'chatgpt', folder: null, email: null, used: false })
  })
})
