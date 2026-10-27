import { describe, expect, it } from 'vitest'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'
import type { Dispatcher } from './dispatcher.js'
import type { LimitedSession } from './relay.js'

const session = (overrides: Partial<LimitedSession> = {}): LimitedSession => ({
  sessionId: 'session-1',
  agentId: 'agent-1',
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/task',
  transcript: null,
  lastReplyAt: '2026-09-26T11:59:00.000Z',
  recent: [],
  lastMessage: null,
  checkpoint: null,
  limit: { at: '2026-09-26T12:00:00.000Z', text: "You've hit your session limit · resets 3pm (UTC)" },
  ...overrides,
})

async function running(options: SetupOptions = {}) {
  const context = setup(options)
  context.dispatcher.setTasks('ABC', [task('ABC-1')])
  context.dispatcher.start('ABC')
  await context.dispatcher.idle()
  context.log.length = 0
  context.limited['ABC-1'] = session()
  return context
}

async function check(dispatcher: Dispatcher) {
  dispatcher.check()
  await dispatcher.idle()
}

describe('Limit lifecycle in the service log', () => {
  it('logs the task, account, known reset and handoff plan once per limit, including after a service restart', async () => {
    const { dispatcher, limited, log } = await running()
    await check(dispatcher)
    expect(log).toEqual([
      'chain: ABC-1: limit reached on account global; resets at 2026-09-26T15:00:00.000Z; next: new session with handoff',
    ])
    await check(dispatcher)
    expect(log).toHaveLength(1)

    const restored = setup({ state: structuredClone(dispatcher.state), limited })
    restored.dispatcher.setTasks('ABC', [task('ABC-1')])
    await check(restored.dispatcher)
    expect(restored.log).toEqual([])
  })

  it('logs an unknown reset and then the learned reset with its updated resume plan, without repeating either', async () => {
    const polled = { reset: null as string | null }
    const { dispatcher, limited, log } = await running({ limitResetAfter: () => polled.reset })
    limited['ABC-1'] = session({ limit: { at: '2026-09-26T12:00:00.000Z', text: 'Usage limit reached' } })
    await check(dispatcher)
    await check(dispatcher)
    expect(log).toEqual(['chain: ABC-1: limit reached on account global; reset unknown; next: new session with handoff'])

    polled.reset = '2026-09-26T12:30:00.000Z'
    await check(dispatcher)
    await check(dispatcher)
    expect(log).toEqual([
      'chain: ABC-1: limit reached on account global; reset unknown; next: new session with handoff',
      'chain: ABC-1: limit reset updated to 2026-09-26T12:30:00.000Z; next: resume',
    ])
  })

  it('logs an earlier reset of a spending limit only when it changes', async () => {
    const polled = { reset: '2026-09-26T15:00:00.000Z' }
    const { dispatcher, limited, log } = await running({ limitResetAfter: () => polled.reset })
    limited['ABC-1'] = session({ limit: { at: '2026-09-26T12:00:00.000Z', text: 'You have reached your specified API usage limits' } })
    await check(dispatcher)
    polled.reset = '2026-09-26T12:30:00.000Z'
    await check(dispatcher)
    await check(dispatcher)
    expect(log).toHaveLength(2)
    expect(log[1]).toBe('chain: ABC-1: limit reset updated to 2026-09-26T12:30:00.000Z; next: resume')
  })

  it('logs a successful resume with the resulting session id only once', async () => {
    const { dispatcher, limited, clock, log } = await running()
    limited['ABC-1'] = session({ lastReplyAt: '2026-09-26T14:29:00.000Z' })
    await check(dispatcher)
    expect(log[0]).toContain('next: resume')
    clock.now = new Date('2026-09-26T15:01:00Z')
    await check(dispatcher)
    await check(dispatcher)
    expect(log).toHaveLength(2)
    expect(log[1]).toBe('chain: ABC-1: continued after the limit by resume in session session-1')
  })

  it('logs a successful handoff with both session ids, then logs a new limit separately', async () => {
    const { dispatcher, limited, clock, log } = await running()
    await check(dispatcher)
    clock.now = new Date('2026-09-26T15:01:00Z')
    await check(dispatcher)
    await check(dispatcher)
    expect(log).toHaveLength(2)
    expect(log[1]).toBe('chain: ABC-1: continued after the limit by handoff to new session session-2 from session-1')

    limited['ABC-1'] = session({
      sessionId: 'session-2',
      limit: { at: '2026-09-26T15:01:00.000Z', text: "You've hit your session limit · resets 5pm (UTC)" },
    })
    await check(dispatcher)
    expect(log).toHaveLength(3)
    expect(log[2]).toContain('resets at 2026-09-26T17:00:00.000Z')
  })

  it('logs the actual handoff when an account switch overrides the resume plan', async () => {
    const { dispatcher, limited, clock, account, log } = await running()
    limited['ABC-1'] = session({ lastReplyAt: '2026-09-26T14:29:00.000Z' })
    await check(dispatcher)
    expect(log[0]).toContain('next: resume')
    account.id = 'jane@example.com'
    clock.now = new Date('2026-09-26T14:35:00Z')
    await check(dispatcher)
    expect(log[1]).toBe('chain: ABC-1: continued after the limit by handoff to new session session-2 from session-1')
  })

  it('does not claim continuation if the handoff fails', async () => {
    const { dispatcher, clock, log } = await running({ failRelay: true })
    await check(dispatcher)
    clock.now = new Date('2026-09-26T15:01:00Z')
    await check(dispatcher)
    expect(log.some((line) => line.includes('continued after the limit'))).toBe(false)
    expect(log.at(-1)).toContain('paused:')
  })
})
