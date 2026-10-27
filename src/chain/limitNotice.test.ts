import { describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { setup, task } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'

describe('spent limit refusal', () => {
  it.each(['restart', 'answer'] as const)('names the account selected for the task on %s', async (action) => {
    const context = setup({
      state: { ...emptyChainState(), active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old', since: '2026-01-01T00:00:00Z' }, paused: false, error: null }] },
      limitReset: '2026-09-26T15:00:00Z',
      account: { id: 'codex-key', ready: true, label: 'Build account', provider: 'codex' },
    })
    context.handoffs['ABC-1'] = { sessionId: 'old', agentId: 'old', account: 'codex-key', cwd: 'D:/abc', workdir: 'D:/abc', branch: 'dev', transcript: null, lastReplyAt: null, recent: [], lastMessage: null, checkpoint: null }
    context.dispatcher.setTasks('ABC', [task('ABC-1')])
    await context.dispatcher.idle()
    let caught: unknown
    try {
      if (action === 'restart') context.dispatcher.restart('ABC', 'ABC-1')
      else context.dispatcher.answer('ABC', 'ABC-1', 'old', null, 'Continue')
    } catch (error) { caught = error }
    expect(noticeOf(caught)).toMatchObject({ code: 'chain.limitSpent', params: { until: '2026-09-26T15:00:00Z', account: 'Build account', provider: 'codex' } })
    expect(context.relays).toEqual([])
  })
})
