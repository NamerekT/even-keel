import { describe, expect, it } from 'vitest'
import { currentAccount } from './current.js'
import { accountAt, emptyLedger, nameAccount } from './ledger.js'
import { accountId, type AccountEntry, type AccountView } from './model.js'

const entry = (key: string, agent: string): AccountEntry => ({
  key, agent, name: `${agent} build`, global: false,
  status: { loggedIn: true, authMethod: 'oauth', email: `${agent}@example.com`, orgName: null, subscriptionType: 'plus' },
  error: null, loginExpiresAt: null, needsLogin: false, sessions: [], projects: [], removing: false,
  configPending: false, apiKey: false, limits: null, usage: { state: 'ok', reason: null, since: null },
})
const view: AccountView = { active: 'global', accounts: [entry('global', 'claude'), entry('build', 'codex')], login: null, loginBlock: null, apps: [], pool: [], missing: [] }

describe('current account for a task', () => {
  it('takes the selected provider account even while the header has another one', () => {
    expect(currentAccount(view, 'build')).toMatchObject({ label: 'codex build', provider: 'codex', ready: true })
    expect(currentAccount(view)).toMatchObject({ label: 'claude build', provider: 'claude', ready: true })
  })
  it('retains the folder identity for a missing selected account', () => {
    expect(currentAccount(view, 'missing')).toMatchObject({ id: null, label: 'missing', ready: false })
  })

  it.each(['opencode', 'copilot'])('keeps %s ready without an email and agrees with its account history', (agent) => {
    const machine = entry(`${agent}-machine`, agent)
    machine.status = { loggedIn: true, authMethod: 'none', email: null, orgName: null, subscriptionType: null }
    const selected = currentAccount({ ...view, accounts: [...view.accounts, machine] }, machine.key)
    expect(selected).toMatchObject({ id: machine.key, provider: agent, ready: true })
    for (const ledger of [emptyLedger(), nameAccount(emptyLedger(), machine.key, 'Build')]) {
      expect(selected.id).toBe(accountId(machine.key, accountAt(ledger, machine.key, '2026-09-26T12:00:00Z')))
    }
    expect(machine.status.email).toBeNull()
    expect(selected.id).not.toBe(currentAccount({ ...view, accounts: [{ ...machine, key: 'other' }] }, 'other').id)
  })

  it.each(['signed out', 'unknown', 'expired', 'signing in'])('keeps an account that is %s unready', (state) => {
    const account = entry('build', 'codex')
    if (state === 'signed out') account.status!.loggedIn = false
    if (state === 'unknown') account.status = null
    if (state === 'expired') account.needsLogin = true
    const login = state === 'signing in'
      ? { agent: 'codex', target: account.key, startedAt: '', urls: [], deviceCode: null, output: '', error: null, codeSent: false }
      : null
    const selected = currentAccount({ ...view, accounts: [account], login }, account.key)
    expect(selected.ready).toBe(false)
    if (state === 'signed out' || state === 'unknown') expect(selected.id).toBeNull()
  })
})
