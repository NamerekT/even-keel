import { describe, expect, it } from 'vitest'
import { notice } from '../notice/notice.js'
import { foldSession } from '../opencode/transcript.js'
import { setup, task } from './dispatcher.fixture.js'

describe('a model refused after launch', () => {
  it.each([false, true])('pauses without touching the session (unattended: %s)', async unattended => {
    const error = { data: { message: "The 'denied' model is not supported when using Codex with a ChatGPT account." } }
    const summary = foldSession([], [], 30, false, [{ at: Date.now(), error }])
    let refused: string | undefined
    const c = setup({ unattended, modelRefusal: (_task, sessionId) => sessionId === refused ? summary.apiError?.notice : undefined })
    c.dispatcher.setTasks('ABC', [task('ABC-1')])
    await c.dispatcher.start('ABC')
    await c.dispatcher.idle()
    refused = 'session-1'
    c.dispatcher.check()
    await c.dispatcher.idle()
    expect(c.dispatcher.state.active[0]).toMatchObject({ paused: true, error: { code: 'chain.modelUnavailable' }, current: { sessionId: 'session-1' } })
    expect(c.stopped).toEqual([])
    expect(c.relays).toEqual([])
    expect(c.dispatcher.state.skipped).toEqual({})
    c.dispatcher.resume('ABC')
    await c.dispatcher.idle()
    expect(c.dispatcher.state.active[0]?.paused).toBe(true)
    c.handoffs['ABC-1'] = {
      sessionId: 'session-1', agentId: 'agent-1', account: 'demo', cwd: '/work/demo', workdir: '/work/demo',
      branch: 'abc-1/task', transcript: null, lastReplyAt: null, recent: [], lastMessage: null, checkpoint: null,
    }
    c.dispatcher.restart('ABC', 'ABC-1')
    await c.dispatcher.idle()
    c.dispatcher.resume('ABC')
    await c.dispatcher.idle()
    expect(c.dispatcher.state.active[0]).toMatchObject({ paused: false, current: { sessionId: 'session-2' } })
  })

  it('ignores a refusal of a previous session', async () => {
    const c = setup({ modelRefusal: (_task, sessionId) => sessionId === 'old-session' ? notice('chain.modelUnavailable', { model: 'openai/denied' }) : undefined })
    c.dispatcher.setTasks('ABC', [task('ABC-1')])
    await c.dispatcher.start('ABC')
    await c.dispatcher.idle()
    expect(c.dispatcher.state.active[0]?.paused).toBe(false)
  })
})
