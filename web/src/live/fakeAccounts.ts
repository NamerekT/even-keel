import {
  folderName,
  loginBlockNotice,
  loginCode,
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
import type { EvenKeelState } from '../../../src/state.js'
import { NO_SIGN_IN } from '../../../src/agent/providers.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { CODEX } from '../../../src/codex/name.js'
import { COPILOT } from '../../../src/copilot/name.js'
import { OPENCODE } from '../../../src/opencode/name.js'

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
  deviceCode: null,
  output: "Browser didn't open? Use the url below to sign in:\n\nhttps://claude.example.com/oauth/authorize?code=true&state=example",
  error: null,
  codeSent: false,
}

const FAKE_DEVICE_OUTPUT =
  'Follow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   https://auth.openai.example.com/codex/device\n\n2. Enter this one-time code (expires in 15 minutes)\n   ABCD-1234\n\nContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\n'

const FAKE_DEVICE_LOGIN: AccountLogin = {
  ...FAKE_LOGIN,
  agent: 'codex',
  urls: ['https://auth.openai.example.com/codex/device'],
  deviceCode: loginCode(FAKE_DEVICE_OUTPUT),
  output: FAKE_DEVICE_OUTPUT.trim(),
}

const FAKE_OPENCODE_OUTPUT = '┌  Add credential\n│\n●  Go to: https://github.example.com/login/device\n│\n●  Enter code: WDJB-MJHT\n│\n◒  Waiting for authorization...\n'

const FAKE_OPENCODE_LOGIN: AccountLogin = {
  ...FAKE_DEVICE_LOGIN,
  agent: 'opencode',
  urls: ['https://github.example.com/login/device'],
  deviceCode: loginCode(FAKE_OPENCODE_OUTPUT),
  output: FAKE_OPENCODE_OUTPUT.trim(),
}

const FAKE_LOGINS: Record<string, AccountLogin> = { [CODEX]: FAKE_DEVICE_LOGIN, [OPENCODE]: FAKE_OPENCODE_LOGIN }

const FAKE_MODELS: Record<string, { models: string[]; complete: boolean }> = {
  [CLAUDE]: { models: ['opus', 'sonnet', 'haiku', 'opusplan', 'sonnet[1m]'], complete: false },
  [CODEX]: { models: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-terra'], complete: false },
  [OPENCODE]: { models: ['opencode/big-pickle', 'opencode/deepseek-v4.1-flash-free', 'anthropic/claude-sonnet-5-5'], complete: true },
}

/** `models/list` of the account folder `key`, by its agent. */
export function fakeModels(account: AccountView, key: string): { models: string[]; complete: boolean } | null {
  const agent = account.accounts.find((entry) => entry.key === key)?.agent
  return agent === undefined ? null : (FAKE_MODELS[agent] ?? null)
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
    keyReplaceable: true,
    ...patch,
  })
}

const OPENCODE_STATUS = { loggedIn: true, authMethod: 'none', email: null, orgName: null, subscriptionType: null }

/** No limits, with why (`UsageAnswer` of kind `missing`). */
function stale(reason: ReturnType<typeof notice>): UsageHealth {
  return { state: 'stale', reason, since: ago(3) }
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

/** A Claude account runs its sessions the way a real one does by default: an API key through the Agent SDK, a subscription through `--bg`. */
function fakeEntry(patch: Partial<AccountEntry>): AccountEntry {
  const entry = rawEntry(patch)
  return entry.agent === 'claude' && entry.transport === undefined ? { ...entry, transport: entry.apiKey ? 'sdk' : 'bg' } : entry
}

function rawEntry(patch: Partial<AccountEntry>): AccountEntry {
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
  if (mode === 'rows' || mode === 'rows-noCodex' || mode === 'rows-long') {
    const base = fakeAccount('opencode', idle, limits)
    const copilot = fakeAccount('copilot', idle, limits).accounts.filter((entry) => entry.agent === COPILOT && !entry.apiKey)
    const lost = apiEntry('old-key', { name: 'Test API', needsLogin: true, sessions: ['Key session'] })
    const accounts = [...base.accounts, ...copilot, lost].map((entry) => entry.key === 'global'
      ? { ...entry, limits: { ...limits, fiveHour: null, sevenDay: { ...limits.sevenDay!, usedPercentage: 99 } }, ...(mode === 'rows-long' ? { name: 'Example organization account with a very long display name that needs truncation' } : {}) }
      : entry.key === 'codex' ? { ...entry, limits: { ...entry.limits!, sevenDay: { ...limits.sevenDay!, usedPercentage: 100 } } } : entry)
    return { ...base, accounts: mode === 'rows-noCodex' ? accounts.filter((entry) => entry.agent !== CODEX) : accounts }
  }
  if (mode === 'empty') return { ...fakeAccount(null, idle, limits), accounts: [], active: 'global', apps: [], pool: [] }
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
  if (mode === 'secondFree') {
    const output = `${FAKE_DEVICE_LOGIN.output}\n\nSuccessfully logged in`
    const error = notice('account.secondFree', { account: 'john.doe@example.com' })
    return { ...signedIn, login: { ...FAKE_DEVICE_LOGIN, deviceCode: null, output, error }, loginBlock: null }
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
  if (mode === 'api' || mode === 'spend' || mode === 'spendUnknown') {
    const lost = apiEntry('old-key', { status: { loggedIn: false, authMethod: 'none', email: null, orgName: null, subscriptionType: null }, needsLogin: true })
    const spendingLimit = mode === 'api' ? null : { resetsAt: mode === 'spendUnknown' ? null : '2026-11-01T00:00:00.000Z' }
    return { ...signedIn, active: 'ci-key', accounts: [global, work, apiEntry('ci-key', { name: 'CI key', sessions: ['ABC-5'], spendingLimit }), lost] }
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
  if (mode === 'opencode') {
    // OPS runs on OpenCode's free models, which have no limits; a second folder signs in with the ChatGPT account the
    // Codex folder is on, and shows their one limit.
    const none = stale(notice('usage.openCodeNone', {}))
    const free = fakeEntry({
      key: 'opencode',
      global: false,
      agent: OPENCODE,
      status: { ...OPENCODE_STATUS, authMethod: 'none' },
      loginExpiresAt: null,
      projects: ['OPS'],
      usage: none,
      lastLimitAt: ago(95),
    })
    const shared = { ...limits, source: 'api' as const, pool: 'chatgpt:acc-1' }
    const chatgpt = fakeEntry({
      key: 'opencode-2',
      global: false,
      agent: OPENCODE,
      status: { ...OPENCODE_STATUS, authMethod: 'oauth', subscriptionType: 'openai' },
      loginExpiresAt: null,
      limits: shared,
      projects: ['DEMO'],
    })
    const codex = codexEntry('codex', 'john.doe@example.com', 'plus', { limits: { ...shared, source: 'usage' } })
    const own = { ...global, projects: FAKE_PROJECTS.filter((project) => project !== 'OPS' && project !== 'DEMO') }
    const pool = [...SHARED_POOL, { project: 'OPS', provider: OPENCODE, account: 'opencode' }, { project: 'DEMO', provider: OPENCODE, account: 'opencode-2' }]
    return { ...signedIn, accounts: [own, work, free, chatgpt, codex], pool }
  }
  if (mode === 'copilot') {
    // OPS runs on the machine's own Copilot sign-in, which has no allowance to read; a second folder has a token of its
    // own and shows what is left of its month.
    const machine = fakeEntry({
      key: 'copilot',
      global: false,
      agent: COPILOT,
      status: { ...OPENCODE_STATUS, authMethod: 'none' },
      loginExpiresAt: null,
      projects: ['OPS'],
      usage: stale(notice('usage.copilotMachine', {})),
    })
    const month = { usedPercentage: 60, resetsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(), left: 120 }
    const allowance = { fiveHour: null, sevenDay: null, month, updatedAt: ago(2), source: 'api' as const }
    const token = fakeEntry({
      key: 'github',
      global: false,
      agent: COPILOT,
      status: { ...OPENCODE_STATUS, authMethod: 'api_key' },
      apiKey: true,
      loginExpiresAt: null,
      limits: allowance,
      projects: ['DEMO'],
    })
    const own = { ...global, projects: FAKE_PROJECTS.filter((project) => project !== 'OPS' && project !== 'DEMO') }
    const pool = [...SHARED_POOL, { project: 'OPS', provider: COPILOT, account: 'copilot' }, { project: 'DEMO', provider: COPILOT, account: 'github' }]
    return { ...signedIn, accounts: [own, work, machine, token], pool }
  }
  if (mode === 'vscode-broken') {
    return { ...signedIn, apps: [{ ...vscode, account: null, dir: null, error: notice('vscode.notJson', {}) }] }
  }
  return signedIn
}

/** The state with `account`: a folder added for an agent with no account in the shared pool becomes it, as `claimShared` does. */
export function withAccount(state: EvenKeelState, account: AccountView): EvenKeelState {
  const before = new Set(state.account.accounts.map((entry) => entry.key))
  let shared = state.config.shared.accounts
  for (const entry of account.accounts) {
    if (before.has(entry.key)) continue
    const current = shared[entry.agent]
    if (current !== undefined && account.accounts.some((each) => each.key === current && each.agent === entry.agent)) continue
    shared = { ...shared, [entry.agent]: entry.key }
  }
  return { ...state, account, config: { ...state.config, shared: { ...state.config.shared, accounts: shared } } }
}

export function accountCommand(account: AccountView, name: string, body: Record<string, unknown>): AccountView {
  const key = String(body.account)
  if (name === 'account/add' || name === 'account/renew') {
    if (account.login !== null && account.login.error === null) throw fail('login.running', {})
    if (name === 'account/renew' && key === account.active && account.loginBlock !== null) throw new NoticeError(loginBlockNotice(account.loginBlock))
    const target = name === 'account/add' ? null : key
    const agent = name === 'account/add' ? String(body.agent ?? CLAUDE) : (account.accounts.find((entry) => entry.key === key)?.agent ?? CLAUDE)
    const method = typeof body.method === 'string' ? body.method : undefined
    // OpenCode's free models and the machine's Copilot sign-in add a folder at once, as the service does.
    if (method === NO_SIGN_IN) {
      const key = folderName(agent, account.accounts.map((entry) => entry.key))
      const placed = rawEntry({ key, agent, global: false, status: OPENCODE_STATUS, loginExpiresAt: null })
      return { ...account, accounts: [...account.accounts, placed] }
    }
    return { ...account, login: { ...(FAKE_LOGINS[agent] ?? FAKE_LOGIN), agent, ...(method !== undefined && { method }), target, startedAt: ago(0) } }
  }
  if (name === 'account/api' || name === 'account/key') {
    const agent = name === 'account/key' ? (account.accounts.find((entry) => entry.key === key)?.agent ?? CLAUDE) : body.agent
    const value = String(body.key).trim()
    const kind = agent === COPILOT ? 'copilotToken' : agent === CODEX ? 'codexKey' : 'apiKey'
    const token = kind !== 'copilotToken' || /^(github_pat_|gho_|ghu_)/.test(value)
    if (!/^\S{21,}$/.test(value) || !token) throw fail(`account.${kind}Invalid`, {})
    if (value.includes('rejected')) throw fail(`account.${kind}Rejected`, {})
    if (value.includes('offline')) throw fail(`account.${kind}Unchecked`, { reason: 'fetch failed' })
    // A key of another organization than the account's is another account (BTN-418).
    if (name === 'account/key') {
      if (value.includes('other-org')) throw fail('account.keyOtherOrganization', { agent: String(agent) })
      const working = { needsLogin: false, status: { loggedIn: true, authMethod: 'api_key', email: key, orgName: null, subscriptionType: null } }
      return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, ...working } : entry)) }
    }
    const given = String(body.name ?? '').trim()
    const folder = folderName(given || 'api', account.accounts.map((entry) => entry.key))
    const entry = apiEntry(folder, { name: given || null, agent: String(body.agent ?? CLAUDE) })
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
  if (name === 'account/name') {
    const given = String(body.name ?? '').trim()
    return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, name: given === '' ? null : given } : entry)) }
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
          : fakeEntry({ key: 'richard.roe', agent: login.agent, global: false, status: { ...FAKE_ACCOUNT, email: 'richard.roe@example.com' }, ...renewed })
      return { ...account, accounts: [...account.accounts, added], login: null }
    }
    const accounts = account.accounts.map((entry) =>
      entry.key === login.target ? { ...entry, ...renewed, status: entry.status ?? FAKE_ACCOUNT } : entry,
    )
    return { ...account, accounts, login: null }
  }
  throw new Error(`fake: ${name} is not supported`)
}
