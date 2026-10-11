import {
  loginBlockNotice,
  removeProblem,
  switchProblem,
  type AccountEntry,
  type AccountLogin,
  type AccountView,
  type ClaudeAccount,
} from '../../../src/account/model.js'
import { appSwitchProblem, type AppAccount } from '../../../src/account/apps.js'
import { fail, notice, NoticeError, textNotice } from '../../../src/notice/notice.js'
import type { RateLimits } from '../../../src/limits/model.js'
import type { UsageHealth } from '../../../src/limits/usage.js'

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

const FAKE_ACCOUNT: ClaudeAccount = {
  loggedIn: true,
  authMethod: 'claude.ai',
  email: 'john.doe@example.com',
  orgName: 'Example Org',
  subscriptionType: 'max',
}

const FAKE_LOGIN: AccountLogin = {
  target: null,
  startedAt: ago(1),
  urls: ['https://claude.example.com/oauth/authorize?code=true&state=example'],
  output: "Browser didn't open? Use the url below to sign in:\n\nhttps://claude.example.com/oauth/authorize?code=true&state=example",
  error: null,
  codeSent: false,
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

function fakeEntry(patch: Partial<AccountEntry>): AccountEntry {
  return {
    key: 'global',
    global: true,
    status: FAKE_ACCOUNT,
    error: null,
    loginExpiresAt: inDays(24),
    needsLogin: false,
    sessions: [],
    removing: false,
    configPending: false,
    limits: null,
    usage: { state: 'ok', reason: null, since: ago(1) },
    ...patch,
  }
}

export function fakeAccount(mode: string | null, idle: boolean, limits: RateLimits): AccountView {
  const global = fakeEntry({ limits, sessions: idle ? [] : ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5', 'Scratch notes'] })
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
      { name: 'example-12', status: 'busy' as const },
      { name: 'Scratch', status: 'idle' as const },
    ]
    return { ...signedIn, apps: [{ ...vscode, sessions }] }
  }
  if (mode === 'many') {
    const window = (usedPercentage: number, hours: number) => ({ usedPercentage, resetsAt: new Date(Date.now() + hours * 3_600_000).toISOString() })
    const spare = (key: string, fiveHour: number, week: number) =>
      fakeEntry({
        key,
        global: false,
        status: { ...FAKE_ACCOUNT, email: `${key}@example.com`, subscriptionType: 'pro' },
        loginExpiresAt: inDays(25),
        sessions: ['ABC-9'],
        limits: { ...limits, fiveHour: window(fiveHour, 2.8), sevenDay: window(week, 100) },
      })
    const spent = { ...global, limits: { ...limits, fiveHour: null, sevenDay: window(100, 10.5) } }
    return { ...signedIn, active: 'jane.roe', accounts: [spent, work, spare('richard.roe', 96, 36), spare('baby.doe', 99, 14)] }
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
    return { ...account, login: { ...FAKE_LOGIN, target: name === 'account/add' ? null : key, startedAt: ago(0) } }
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
      const added = fakeEntry({ key: 'richard.roe', global: false, status: { ...FAKE_ACCOUNT, email: 'richard.roe@example.com' }, ...renewed })
      return { ...account, accounts: [...account.accounts, added], login: null }
    }
    const accounts = account.accounts.map((entry) =>
      entry.key === login.target ? { ...entry, ...renewed, status: entry.status ?? FAKE_ACCOUNT } : entry,
    )
    return { ...account, accounts, login: null }
  }
  throw new Error(`fake: ${name} is not supported`)
}
