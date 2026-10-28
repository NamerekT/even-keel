import { describe, expect, it } from 'vitest'
import { currentAccount } from '../account/current.js'
import { accountAt, emptyLedger } from '../account/ledger.js'
import { accountId, type AccountEntry, type AccountView } from '../account/model.js'
import { done, setup, task } from './dispatcher.fixture.js'
import { failedRun, fakeMain } from './maincheck.fixture.js'

async function interrupted(agent: string) {
  const entry: AccountEntry = {
    key: `${agent}-machine`, agent, name: null, global: false,
    status: { loggedIn: true, authMethod: 'none', email: null, orgName: null, subscriptionType: null },
    error: null, loginExpiresAt: null, needsLogin: false, sessions: [], projects: [], removing: false,
    configPending: false, apiKey: false, limits: null, usage: { state: 'ok', reason: null, since: null },
  }
  const view: AccountView = { active: entry.key, accounts: [entry], login: null, loginBlock: null, apps: [], pool: [], missing: [] }
  const { ci, deps } = fakeMain(10 * 60_000)
  ci.fixTask = false
  const ledger = emptyLedger()
  const harness = setup({
    main: deps,
    account: currentAccount(view),
    accountAt: (key, at) => accountId(key, accountAt(ledger, key, at)),
  })
  const { dispatcher, busy, handoffs } = harness
  dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  dispatcher.start('ABC')
  await dispatcher.idle()
  dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
  await dispatcher.idle()
  harness.clock.now = new Date('2026-09-26T12:10:00Z')
  dispatcher.check()
  await dispatcher.idle()
  busy.add('ABC-2')
  handoffs['ABC-2'] = {
    sessionId: 'session-2', agentId: 'agent-2', account: entry.key,
    cwd: '/repo/.claude/worktrees/abc-2', workdir: '/repo/.claude/worktrees/abc-2', branch: 'abc-2/task',
    transcript: null, lastReplyAt: '2026-09-26T12:09:00Z', recent: [], lastMessage: null, checkpoint: null,
  }
  ci.verdict = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] }
  dispatcher.check()
  await dispatcher.idle()
  expect(harness.stopped).toEqual(['session-2'])
  expect(dispatcher.state.active[0]?.interrupted?.sessionId).toBe('session-2')
  busy.delete('ABC-2')
  ci.verdict = { state: 'pending' }
  ci.merged.add('ABC-FIX')
  dispatcher.check()
  await dispatcher.idle()
  expect(dispatcher.state.active[0]).toMatchObject({ current: null, interrupted: { fixed: 'cccccccccc' } })
  expect(harness.relays).toEqual([])
  ci.verdict = { state: 'green' }
  return { ...harness, view }
}

describe.each(['opencode', 'copilot'])('MainFix with a machine %s account', (agent) => {
  it('continues the same session after green CI while its cache is warm', async () => {
    const { dispatcher, relays, journal } = await interrupted(agent)
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-2', sessionId: 'session-2' }])
    expect(relays[0]!.prompt).toContain('ccccccc')
    expect(journal.at(-1)).toMatchObject({ reason: 'resume', previous: 'session-2' })
    expect(dispatcher.state.active[0]?.interrupted).toBeUndefined()
    expect(dispatcher.state.active[0]?.current?.sessionId).toBe('session-2')
  })

  it('hands over when the selected account folder changes', async () => {
    const { dispatcher, account, relays } = await interrupted(agent)
    account.id = accountId('other-machine', null)
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toMatchObject([{ kind: 'relay', task: 'ABC-2', reason: 'mainFixed' }])
    expect(dispatcher.state.active[0]?.interrupted).toBeUndefined()
  })

  it('waits while signed out and continues after the account is ready again', async () => {
    const { dispatcher, account, view, relays } = await interrupted(agent)
    view.accounts[0]!.status!.loggedIn = false
    Object.assign(account, currentAccount(view))
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toEqual([])
    expect(dispatcher.state.active[0]?.interrupted?.task).toBe('ABC-2')
    view.accounts[0]!.status!.loggedIn = true
    Object.assign(account, currentAccount(view))
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-2' }])
  })
})
