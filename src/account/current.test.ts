import { describe, expect, it } from 'vitest'
import { currentAccount } from './current.js'
import type { AccountEntry, AccountView } from './model.js'

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
    expect(currentAccount(view, 'missing')).toMatchObject({ label: 'missing', ready: false })
  })
})
