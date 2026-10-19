import {
  folderName,
  loginBlockNotice,
  removeProblem,
  switchProblem,
  type AccountEntry,
  type AccountLogin,
  type AccountView,
  type AccountStatus,
  type PoolEntry,
} from '../../../src/account/model.js'
import { appSwitchProblem, type AppAccount } from '../../../src/account/apps.js'
import { fail, notice, NoticeError, textNotice } from '../../../src/notice/notice.js'
import type { RateLimits } from '../../../src/limits/model.js'
import type { UsageHealth } from '../../../src/limits/usage.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { CODEX } from '../../../src/codex/name.js'

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

const FAKE_ACCOUNT: AccountStatus = {
  loggedIn: true,
  authMethod: 'claude.ai',
  email: 'john.doe@example.com',
  orgName: 'Example Org',
  subscriptionType: 'max',
}

/** The fake page's projects, all on the shared pool unless a mode gives one a folder of its own. */
const FAKE_PROJECTS = ['ABC', 'DEMO', 'XYZ', 'OPS']
const SHARED_POOL: PoolEntry[] = [
  { project: null, provider: CLAUDE, account: 'global' },
  { project: null, provider: CODEX, account: 'codex' },
]

const FAKE_LOGIN: AccountLogin = {
  agent: 'claude',
  target: null,
  startedAt: ago(1),
  urls: ['https://claude.example.com/oauth/authorize?code=true&state=example'],
  output: "Browser didn't open? Use the url below to sign in:\n\nhttps://claude.example.com/oauth/authorize?code=true&state=example",
  error: null,
  codeSent: false,
}

const FAKE_DEVICE_LOGIN: AccountLogin = {
  ...FAKE_LOGIN,
  agent: 'codex',
  urls: ['https://auth.openai.example.com/codex/device'],
  output: 'Follow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in\n   https://auth.openai.example.com/codex/device\n\n2. Enter this one-time code\n   ABCD-1234',
}

export function fakeUsage(mode: string | null): UsageHealth {
  if (mode === 'unread') return { state: 'unread', reason: notice('usage.noWeek', {}), since: ago(12) }
  if (mode === 'off') return { state: 'off', reason: notice('usage.turns', { value: '1' }), since: ago(3) }
  if (mode === 'waiting') return { state: 'waiting', reason: null, since: null }
  return { state: 'ok', reason: null, since: ago(60) }
}

export const FAKE_LIMITS: RateLimits = {
  fiveHour: { usedPercentage: 37, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
  sevenDay: { usedPercentage: 64, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
  updatedAt: ago(0),
  source: 'usage',
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

/** An API account: the CLI reports no e-mail, so the folder key stands in for it (`withIdentity`). */
function apiEntry(key: string, patch: Partial<AccountEntry> = {}): AccountEntry {
  return fakeEntry({
    key,
    global: false,
    status: { loggedIn: true, authMethod: 'api_key', email: key, orgName: null, subscriptionType: null },
    loginExpiresAt: null,
    apiKey: true,
    ...patch,
  })
}

function codexEntry(key: string, email: string, plan: string, patch: Partial<AccountEntry> = {}): AccountEntry {
  return fakeEntry({
    key,
    global: false,
    agent: CODEX,
    status: { loggedIn: true, authMethod: 'chatgpt', email, orgName: null, subscriptionType: plan },
    loginExpiresAt: null,
    ...patch,
  })
}

function fakeEntry(patch: Partial<AccountEntry>): AccountEntry {
  return {
    key: 'global',
    name: null,
    global: true,
    agent: 'claude',
    status: FAKE_ACCOUNT,
    error: null,
    loginExpiresAt: inDays(24),
    needsLogin: false,
    sessions: [],
    projects: [],
    removing: false,
    configPending: false,
    apiKey: false,
    limits: null,
    usage: { state: 'ok', reason: null, since: ago(1) },
    ...patch,
  }
}

export function fakeAccount(mode: string | null, idle: boolean, limits: RateLimits): AccountView {
  const global = fakeEntry({ limits, projects: FAKE_PROJECTS, sessions: idle ? [] : ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5', 'Scratch notes'] })
  const work = fakeEntry({
    key: 'jane.roe',
    global: false,
    status: { ...FAKE_ACCOUNT, email: 'jane.roe@example.com', subscriptionType: 'pro' },
    loginExpiresAt: inDays(5),
    usage: { state: 'stale', reason: null, since: ago(30) },
  })
  const vscode: AppAccount = { app: 'vscode', account: 'jane.roe', dir: 'C:\\Users\\john\\.claude-accounts\\jane.roe', error: null, sessions: [] }
  const signedIn: AccountView = {
    active: 'global',
    accounts: [global, work],
    apps: [vscode],
    pool: SHARED_POOL,
    missing: [],
    login: null,
    loginBlock: idle
      ? null
      : {
          chains: ['ABC'],
          sessions: [
            { name: 'ABC-5', status: 'busy', waitingFor: null },
            { name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' },
          ],
        },
  }
  if (mode === 'out') {
    const out = { ...global, status: { loggedIn: false, authMethod: 'none', email: null, orgName: null, subscriptionType: null }, needsLogin: true }
    return { ...signedIn, accounts: [out, work] }
  }
  if (mode === 'expired') return { ...signedIn, accounts: [{ ...global, loginExpiresAt: ago(60), needsLogin: true, limits: null }, work] }
  if (mode === 'login') return { ...signedIn, login: FAKE_LOGIN, loginBlock: null }
  if (mode === 'failed') {
    return { ...signedIn, login: { ...FAKE_LOGIN, error: notice('login.exited', { code: '1' }, { detail: 'OAuth error' }) }, loginBlock: null }
  }
  if (mode === 'unknown') return { ...signedIn, accounts: [{ ...global, status: null, error: textNotice('claude: auth status timed out') }, work] }
  const workSessions = ['ABC-7', 'ABC-8']
  if (mode === 'pending') return { ...signedIn, accounts: [global, { ...work, sessions: workSessions, configPending: true }] }
  if (mode === 'removing') return { ...signedIn, accounts: [global, { ...work, sessions: workSessions, removing: true }] }
  if (mode === 'vscode-chats') {
    const sessions = [
      { name: 'Header colours on the accounts page', session: 'example-12', account: 'jane.roe', status: 'busy' as const },
      { name: 'Scratch', session: 'example-13', account: 'jane.roe', status: 'idle' as const },
    ]
    return { ...signedIn, accounts: [global, { ...work, sessions: ['example-12', 'example-13'] }], apps: [{ ...vscode, sessions }] }
  }
  if (mode === 'many') {
    const window = (usedPercentage: number, hours: number) => ({ usedPercentage, resetsAt: new Date(Date.now() + hours * 3_600_000).toISOString() })
    const spare = (key: string, fiveHour: number, week: number, patch: Partial<AccountEntry>) =>
      fakeEntry({
        key,
        global: false,
        status: { ...FAKE_ACCOUNT, email: `${key}@example.com`, subscriptionType: 'pro' },
        loginExpiresAt: inDays(25),
        sessions: ['ABC-9'],
        limits: { ...limits, fiveHour: window(fiveHour, 2.8), sevenDay: window(week, 100) },
        ...patch,
      })
    // The shared pool moved to jane.roe; XYZ and OPS kept a folder of their own.
    const spent = { ...global, projects: [], limits: { ...limits, fiveHour: null, sevenDay: window(100, 10.5) } }
    const pool = [
      { project: null, provider: CLAUDE, account: 'jane.roe' },
      { project: null, provider: CODEX, account: 'codex' },
      { project: 'XYZ', provider: CLAUDE, account: 'richard.roe' },
      { project: 'OPS', provider: CLAUDE, account: 'baby.doe' },
    ]
    const accounts = [
      spent,
      { ...work, projects: ['ABC', 'DEMO'], limits },
      spare('richard.roe', 96, 36, { projects: ['XYZ'] }),
      spare('baby.doe', 99, 14, { projects: ['OPS'] }),
    ]
    return { ...signedIn, active: 'jane.roe', accounts, pool }
  }
  if (mode === 'api') {
    const lost = apiEntry('old-key', { status: { loggedIn: false, authMethod: 'none', email: null, orgName: null, subscriptionType: null }, needsLogin: true })
    return { ...signedIn, active: 'ci-key', accounts: [global, work, apiEntry('ci-key', { name: 'CI key', sessions: ['ABC-5'] }), lost] }
  }
  if (mode === 'codex') {
    const codex = codexEntry('codex', 'john.doe@example.com', 'free', {
      global: true,
      limits: { ...limits, fiveHour: null, sevenDay: null, month: { usedPercentage: 12, resetsAt: new Date(Date.now() + 11 * 86_400_000).toISOString() } },
    })
    // OPS runs on Codex, on a paid folder of its own.
    const paid = codexEntry('jane.roe-2', 'jane.roe@example.com', 'plus', { limits, projects: ['OPS'] })
    // A plan that turned free next to the free one: held, with the warning on its card.
    const extra = codexEntry('baby.doe', 'baby.doe@example.com', 'free')
    const own = { ...global, projects: FAKE_PROJECTS.filter((project) => project !== 'OPS') }
    const pool = [...SHARED_POOL, { project: 'OPS', provider: CODEX, account: 'jane.roe-2' }]
    return { ...signedIn, accounts: [own, work, apiEntry('ci-key', { name: 'CI key' }), codex, paid, extra], pool }
  }
  if (mode === 'vscode-broken') {
    return { ...signedIn, apps: [{ ...vscode, account: null, dir: null, error: notice('vscode.notJson', {}) }] }
  }
  return signedIn
}

export function accountCommand(account: AccountView, name: string, body: Record<string, unknown>): AccountView {
  const key = String(body.account)
  if (name === 'account/add' || name === 'account/renew') {
    if (account.login !== null && account.login.error === null) throw fail('login.running', {})
    if (name === 'account/renew' && key === account.active && account.loginBlock !== null) throw new NoticeError(loginBlockNotice(account.loginBlock))
    const target = name === 'account/add' ? null : key
    const agent = name === 'account/add' ? String(body.agent ?? CLAUDE) : (account.accounts.find((entry) => entry.key === key)?.agent ?? CLAUDE)
    return { ...account, login: { ...(agent === CODEX ? FAKE_DEVICE_LOGIN : FAKE_LOGIN), agent, target, startedAt: ago(0) } }
  }
  if (name === 'account/api') {
    const value = String(body.key).trim()
    const codex = body.agent === CODEX
    if (!/^\S{21,}$/.test(value)) throw fail(codex ? 'account.codexKeyInvalid' : 'account.apiKeyInvalid', {})
    if (value.includes('rejected')) throw fail(codex ? 'account.codexKeyRejected' : 'account.apiKeyRejected', {})
    if (value.includes('offline')) throw fail(codex ? 'account.codexKeyUnchecked' : 'account.apiKeyUnchecked', { reason: 'fetch failed' })
    const name = String(body.name ?? '').trim()
    const key = folderName(name || 'api', account.accounts.map((entry) => entry.key))
    const entry = apiEntry(key, { name: name || null, ...(codex ? { agent: CODEX } : {}) })
    return { ...account, accounts: [...account.accounts, entry] }
  }
  if (name === 'account/switch') {
    const problem = switchProblem(account, key)
    if (problem !== undefined) throw new NoticeError(problem)
    return { ...account, active: key }
  }
  if (name === 'account/app') {
    const problem = appSwitchProblem(account, String(body.app), key)
    if (problem !== undefined) throw new NoticeError(problem)
    return { ...account, apps: account.apps.map((app) => (app.app === body.app ? { ...app, account: key } : app)) }
  }
  if (name === 'account/remove') {
    const problem = removeProblem(account, key)
    if (problem !== undefined) throw new NoticeError(problem)
    const busy = account.accounts.some((entry) => entry.key === key && entry.sessions.length > 0)
    if (busy) return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, removing: true } : entry)) }
    return { ...account, accounts: account.accounts.filter((entry) => entry.key !== key) }
  }
  if (name === 'account/keep') {
    return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, removing: false } : entry)) }
  }
  if (name === 'account/cancel') return { ...account, login: null }
  if (name === 'account/code') {
    const { login } = account
    if (login === null) throw fail('login.none', {})
    if (String(body.code).trim() === 'fail') {
      return { ...account, login: { ...login, error: notice('login.exited', { code: '1' }, { detail: 'Invalid code' }) } }
    }
    const renewed = { loginExpiresAt: inDays(30), needsLogin: false }
    if (login.target === null) {
      const added =
        login.agent === CODEX
          ? codexEntry('richard.roe', 'richard.roe@example.com', 'plus')
          : fakeEntry({ key: 'richard.roe', global: false, status: { ...FAKE_ACCOUNT, email: 'richard.roe@example.com' }, ...renewed })
      return { ...account, accounts: [...account.accounts, added], login: null }
    }
    const accounts = account.accounts.map((entry) =>
      entry.key === login.target ? { ...entry, ...renewed, status: entry.status ?? FAKE_ACCOUNT } : entry,
    )
    return { ...account, accounts, login: null }
  }
  throw new Error(`fake: ${name} is not supported`)
}
