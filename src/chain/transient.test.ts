import { describe, expect, it } from 'vitest'
import { setup, task, pause } from './dispatcher.fixture.js'
import type { LimitedSession } from './relay.js'

const MIN = 60_000
const t0 = Date.parse('2026-09-26T12:00:00Z')
const at = (minutes: number) => new Date(t0 + minutes * MIN).toISOString()
const session = (minutes = 0): LimitedSession => ({
  sessionId: 'session-1', agentId: 'agent-1', account: 'global',
  cwd: 'D:/fake', workdir: 'D:/fake', branch: 'abc-1/task', transcript: null,
  lastReplyAt: at(-60), recent: [], lastMessage: null, checkpoint: null,
  transient: true, limit: { at: at(minutes), text: 'Selected model is at capacity.' },
})
const check = async (context: ReturnType<typeof setup>, minutes: number) => {
  context.clock.now = new Date(at(minutes))
  context.dispatcher.check()
  await context.dispatcher.idle()
}
const running = async () => {
  const context = setup()
  context.dispatcher.setTasks('ABC', [task('ABC-1')])
  context.dispatcher.start('ABC')
  await context.dispatcher.idle()
  context.limited['ABC-1'] = session()
  context.handoffs['ABC-1'] = context.limited['ABC-1']!
  return context
}

describe('retrying a temporary model refusal', () => {
  it('resumes the same session once after 15 minutes, even with a cold cache', async () => {
    const c = await running()
    await check(c, 0)
    expect(c.dispatcher.state.active[0]?.current?.limit).toMatchObject({ resetsAt: at(15), then: 'resume' })
    await check(c, 14)
    expect(c.relays).toEqual([])
    await check(c, 15)
    await check(c, 16)
    expect(c.relays).toHaveLength(1)
    expect(c.relays[0]).toMatchObject({ kind: 'reply', sessionId: 'session-1' })
    expect(c.relays[0]?.prompt).toContain('временной')
    expect(c.journal.at(-1)).toMatchObject({ reason: 'resume', sessionId: 'session-1' })
  })

  it('doubles delays to four hours and resets after a successful answer', async () => {
    const c = await running()
    let minute = 0
    for (const wait of [15, 30, 60, 120, 240, 240]) {
      c.limited['ABC-1'] = session(minute)
      await check(c, minute)
      expect(c.dispatcher.state.active[0]?.current?.limit?.resetsAt).toBe(at(minute + wait))
      minute += wait
      await check(c, minute)
      minute++
    }
    delete c.limited['ABC-1']
    c.handoffs['ABC-1'] = { ...session(), lastReplyAt: at(minute) }
    await check(c, minute)
    c.limited['ABC-1'] = session(minute + 1)
    await check(c, minute + 1)
    expect(c.dispatcher.state.active[0]?.current?.limit?.resetsAt).toBe(at(minute + 16))
  })

  it('cancels the scheduled retry when a person answers, even before the transcript updates', async () => {
    const c = await running()
    await check(c, 0)
    c.clock.now = new Date(at(5))
    expect(await c.dispatcher.answer('ABC', 'ABC-1', 'session-1', null, 'Continue now')).toBe(true)
    await check(c, 16)
    expect(c.relays).toHaveLength(1)
    expect(c.relays[0]?.prompt).toBe('Continue now')
    expect(c.dispatcher.state.active[0]?.current?.limit).toBeUndefined()
  })

  it('does not retry while paused or mid-turn, or act on another session', async () => {
    const c = await running()
    await check(c, 0)
    c.busy.add('ABC-1')
    await check(c, 16)
    expect(c.relays).toEqual([])
    c.busy.clear()
    c.limited['ABC-1'] = { ...session(), sessionId: 'old-session' }
    await check(c, 17)
    expect(c.relays).toEqual([])
    c.limited['ABC-1'] = session()
    pause(c.dispatcher, 'ABC')
    await check(c, 20)
    expect(c.relays).toEqual([])
  })

  it('retains a scheduled retry through a service restart without sending it twice', async () => {
    const c = await running()
    await check(c, 0)
    const restored = setup({ state: structuredClone(c.dispatcher.state), limited: c.limited })
    restored.dispatcher.setTasks('ABC', [task('ABC-1')])
    await check(restored, 14)
    expect(restored.relays).toEqual([])
    await check(restored, 15)
    await check(restored, 16)
    expect(restored.relays).toHaveLength(1)
  })

  it('restarts the ladder after a person continues', async () => {
    const c = await running()
    await check(c, 0)
    await check(c, 15)
    c.limited['ABC-1'] = session(16)
    await check(c, 16)
    c.clock.now = new Date(at(20))
    await c.dispatcher.answer('ABC', 'ABC-1', 'session-1', null, 'Continue now')
    c.limited['ABC-1'] = session(21)
    await check(c, 21)
    expect(c.dispatcher.state.active[0]?.current?.limit?.resetsAt).toBe(at(36))
  })

  it('lets New session replace the session and cancels the old retry', async () => {
    const c = await running()
    await check(c, 0)
    c.dispatcher.restart('ABC', 'ABC-1')
    await c.dispatcher.idle()
    await check(c, 16)
    expect(c.relays).toHaveLength(1)
    expect(c.relays[0]?.kind).toBe('relay')
    expect(c.dispatcher.state.active[0]?.current?.sessionId).toBe('session-2')
    expect(c.dispatcher.state.active[0]?.current?.limit).toBeUndefined()
  })
})
