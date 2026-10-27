import { describe, expect, it } from 'vitest'
import { CreditChecks } from '../account/credit.js'
import { setup, task } from './dispatcher.fixture.js'
import type { LimitedSession } from './relay.js'

const TEXT = 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.'
const AT = '2026-09-26T12:00:00.000Z'

describe('a chain on an API spending limit', () => {
  async function running() {
    const checks = new CreditChecks(5 * 60_000)
    const context = setup({ limitResetAfter: (key, at, text) => checks.restoredAfter(key, at, context.clock.now, text) })
    const { dispatcher, limited } = context
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    limited['ABC-1'] = {
      sessionId: 'session-1', agentId: 'session-1', account: 'global', cwd: 'D:/work/abc', workdir: 'D:/work/abc',
      branch: 'abc-1/task', transcript: null, lastReplyAt: AT, recent: [], lastMessage: null, checkpoint: null,
      limit: { at: AT, text: TEXT }, warmMs: 4 * 60_000,
    } satisfies LimitedSession
    await tick(context)
    return { ...context, checks }
  }

  async function tick({ dispatcher }: ReturnType<typeof setup>) {
    dispatcher.check()
    await dispatcher.idle()
  }

  it('waits for the transcript date and keeps the key checked even with a known reset', async () => {
    const ctx = await running()
    expect(ctx.dispatcher.state.active[0]?.current?.limit?.resetsAt).toBe('2026-11-01T00:00:00.000Z')
    ctx.clock.now = new Date('2026-09-26T12:15:00Z')
    await tick(ctx)
    expect(ctx.checks.due(ctx.clock.now)).toEqual(['global'])
    expect(ctx.relays).toEqual([])
    ctx.clock.now = new Date('2026-11-01T00:00:00Z')
    await tick(ctx)
    expect(ctx.relays).toEqual([])
    ctx.clock.now = new Date('2026-11-01T00:01:00Z')
    await tick(ctx)
    expect(ctx.relays[0]?.kind).toBe('relay')
  })

  it.each([2, 20])('continues early once the key can pay again after %i minutes', async (minute) => {
    const ctx = await running()
    ctx.clock.now = new Date(`2026-09-26T12:${String(minute).padStart(2, '0')}:00Z`)
    ctx.checks.note('global', { state: 'empty' }, ctx.clock.now)
    await tick(ctx)
    expect(ctx.relays).toEqual([])
    ctx.checks.note('global', { state: 'ok' }, ctx.clock.now)
    await tick(ctx)
    expect(ctx.relays).toEqual([])
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 60_000)
    await tick(ctx)
    expect(ctx.relays[0]?.kind).toBe(minute === 2 ? 'resume' : 'relay')
  })
})
