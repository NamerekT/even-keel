import { beforeEach, describe, expect, it } from 'vitest'
import type { AccountEntry, AccountView } from '../../../src/account/model.js'
import { notice } from '../../../src/notice/notice.js'
import { setLanguage } from '../i18n/index.js'
import { usageGroups, usageNotices } from './usageNotices.js'

const entry = (key: string, patch: Partial<AccountEntry> = {}): AccountEntry => ({
  key, name: null, agent: 'claude', global: false,
  status: { loggedIn: true, authMethod: 'oauth', email: `${key}@example.com`, orgName: null, subscriptionType: 'pro' },
  error: null, loginExpiresAt: null, needsLogin: false, sessions: [], projects: [], removing: false,
  configPending: false, apiKey: false, limits: null,
  usage: { state: 'unread', reason: notice('usage.noSession', {}), since: '2026-10-29T12:00:00Z' },
  ...patch,
})

const view = (accounts: AccountEntry[]): AccountView => ({
  active: 'codex', accounts, login: null, loginBlock: null, apps: [], missing: [],
  pool: [
    { project: null, provider: 'claude', account: 'shared' },
    { project: null, provider: 'codex', account: 'codex' },
    { project: 'project-a', provider: 'claude', account: 'project' },
    { project: 'project-b', provider: 'claude', account: 'shared' },
  ],
})

describe('usageNotices', () => {
  beforeEach(() => setLanguage('en'))

  it('names each account in any pool once, independently of the active provider', () => {
    const state = view([entry('shared', { name: 'Build team' }), entry('project'), entry('unused'), entry('codex', {
      agent: 'codex', usage: { state: 'waiting', reason: null, since: null },
    })])
    const notices = usageNotices(state)
    expect(notices.map((each) => each.account)).toEqual(['shared', 'project'])
    expect(notices[0]?.text).toContain('Build team')
    expect(notices[0]?.text).not.toContain('/usage')
    expect(notices[0]?.detail).toContain('/usage')
    expect(notices[1]?.text).toContain('project@example.com')
    expect(notices[0]?.key).not.toBe(notices[1]?.key)
    state.active = 'shared'
    expect(usageNotices(state)).toEqual(notices)
  })

  it('puts accounts whose limits are unread alike into one banner, a stopped poll apart', () => {
    const off = { usage: { state: 'off', reason: notice('usage.turns', { value: '1' }), since: 'now' } } as const
    const groups = usageGroups(usageNotices(view([entry('shared', { name: 'Build team' }), entry('codex', { agent: 'codex', status: null }), entry('project', off)])))
    expect(groups.map((group) => group.notices.map((each) => each.account))).toEqual([['shared', 'codex'], ['project']])
    expect(groups[0]).toMatchObject({ tone: 'warn' })
    expect(groups[0]?.notices.map((each) => each.name)).toEqual(['Build team', 'Codex'])
    expect(groups[1]).toMatchObject({ tone: 'error' })
  })

  it('shows no warning for an account that needs sign-in', () => {
    expect(usageNotices(view([entry('shared', { needsLogin: true })]))).toEqual([])
  })

  it('keeps a stopped poll an error and uses the same numbered account names as the page', () => {
    const anonymous = { status: null }
    const notices = usageNotices(view([
      entry('project', anonymous),
      entry('shared', { ...anonymous, usage: { state: 'off', reason: notice('usage.turns', { value: '1' }), since: 'now' } }),
    ]))
    expect(notices[0]?.text).toMatch(/^Claude Code:/)
    expect(notices[1]).toMatchObject({ tone: 'error' })
    expect(notices[1]?.text).toMatch(/^Claude Code 2:/)
  })
})
