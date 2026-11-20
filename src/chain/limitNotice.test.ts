import { describe, expect, it } from 'vitest'
import { notice, noticeOf } from '../notice/notice.js'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'

const SELECTED = { id: 'claude-b', ready: true, label: 'Account B', provider: 'claude' }
const SESSION_SPENT = notice('chain.limitSpent', { until: '2026-09-26T18:00:00Z', account: 'Account A', provider: 'codex' })

async function waiting(options: SetupOptions) {
  const context = setup({
    state: { ...emptyChainState(), active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old', since: '2026-01-01T00:00:00Z' }, paused: false, error: null }] },
    account: SELECTED,
    ...options,
  })
  context.handoffs['ABC-1'] = { sessionId: 'old', agentId: 'old', account: 'codex-a', cwd: 'D:/abc', workdir: 'D:/abc', branch: 'dev', transcript: null, lastReplyAt: null, recent: [], lastMessage: null, checkpoint: null }
  context.dispatcher.setTasks('ABC', [task('ABC-1')])
  await context.dispatcher.idle()
  return context
}

function refusal(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return noticeOf(error)
  }
  return undefined
}

describe('spent limit refusal', () => {
  it.each(['restart', 'renew'] as const)('names the account selected for the task on %s, a new session', async (action) => {
    const context = await waiting({ limitReset: '2026-09-26T15:00:00Z' })
    const caught = refusal(() => action === 'restart' ? context.dispatcher.restart('ABC', 'ABC-1') : context.dispatcher.renew('ABC', 'ABC-1', 'old', null, 'Continue'))
    expect(caught).toMatchObject({ code: 'chain.limitSpent', params: { until: '2026-09-26T15:00:00Z', account: 'Account B', provider: 'claude' } })
    expect(context.relays).toEqual([])
  })

  it('lets an answer reach the session when only the account selected for the next launch is spent or blocked (BTN-1396)', async () => {
    const context = await waiting({ limitReset: '2026-09-26T15:00:00Z', blocked: (_project, task) => task === undefined ? undefined : notice('account.signedOut', {}) })
    await expect(context.dispatcher.answer('ABC', 'ABC-1', 'old', null, 'Continue')).resolves.toBe(true)
    expect(context.relays).toMatchObject([{ kind: 'reply', sessionId: 'old' }])
  })

  it("refuses an answer by the session's own account and names it", async () => {
    const context = await waiting({ sessionBlock: (task) => (task === 'ABC-1' ? SESSION_SPENT : undefined) })
    expect(refusal(() => context.dispatcher.answer('ABC', 'ABC-1', 'old', null, 'Continue'))).toEqual(SESSION_SPENT)
    expect(context.relays).toEqual([])
  })

  it("starts a new session on the selected account when only the session's own account is spent", async () => {
    const context = await waiting({ sessionBlock: () => SESSION_SPENT })
    expect(refusal(() => context.dispatcher.renew('ABC', 'ABC-1', 'old', null, 'Continue'))).toBeUndefined()
  })
})
