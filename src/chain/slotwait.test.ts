import { describe, expect, it } from 'vitest'
import { fail, notice } from '../notice/notice.js'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'

const dirty = notice('slot.dirty', { path: 'D:/work/abc/.claude/worktrees/even-keel' }, { detail: 'M src/app.ts' })
const noneFree = (id: string) => fail('slot.noneFree', { task: id }, { items: [dirty] })

async function started(options: SetupOptions = {}) {
  const context = setup({ unattended: true, refuse: { 'ABC-1': noneFree('ABC-1') }, ...options })
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  context.dispatcher.start('ABC')
  await context.dispatcher.idle()
  return context
}

async function poll(context: Awaited<ReturnType<typeof started>>) {
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
}

describe('Dispatcher with no free slot', () => {
  it('keeps an unattended chain running and waits for a slot instead of pausing', async () => {
    const { dispatcher, log } = await started()
    const chain = dispatcher.state.active[0]!

    expect(chain.paused).toBe(false)
    expect(chain.error).toBeNull()
    expect(chain.current).toBeNull()
    expect(chain.slotWait).toEqual({ notice: notice('slot.waiting', { task: 'ABC-1' }, { items: [dirty] }), at: '2026-09-26T12:00:00.000Z' })
    expect(dispatcher.state.released).toEqual({})
    expect(log).toEqual(['chain: ABC: no slot is free for ABC-1; it starts as soon as one is:\nthe slot D:/work/abc/.claude/worktrees/even-keel has uncommitted changes; commit or remove them: M src/app.ts'])
  })

  it('tries again no sooner than half a minute later and logs the same wait once', async () => {
    const context = await started()
    await poll(context)
    expect(context.tried).toEqual(['ABC/ABC-1'])

    context.clock.now = new Date('2026-09-26T12:00:30Z')
    await poll(context)
    expect(context.tried).toEqual(['ABC/ABC-1', 'ABC/ABC-1'])
    expect(context.dispatcher.state.active[0]!.slotWait?.at).toBe('2026-09-26T12:00:30.000Z')
    expect(context.log).toHaveLength(1)
  })

  it('starts the task once a slot is free and forgets the wait', async () => {
    const context = await started()
    delete context.refuse['ABC-1']
    context.clock.now = new Date('2026-09-26T12:01:00Z')
    await poll(context)

    const chain = context.dispatcher.state.active[0]!
    expect(context.launched).toEqual(['ABC/ABC-1'])
    expect(chain.current?.task).toBe('ABC-1')
    expect(chain.slotWait).toBeUndefined()
  })

  it('waits the same way for a slot held by a session mid-turn', async () => {
    const busy = fail('slot.busyStart', { slot: 'D:/work/abc/.claude/worktrees/even-keel', sessions: ['ABC-9 (old-session)'], task: 'ABC-1' })
    const { dispatcher } = await started({ refuse: { 'ABC-1': busy } })
    const chain = dispatcher.state.active[0]!
    expect(chain.paused).toBe(false)
    expect(chain.slotWait?.notice.items?.[0]?.code).toBe('slot.busyStart')
  })

  it('pauses outside the unattended mode, as before, and says so in the log', async () => {
    const { dispatcher, log } = await started({ unattended: false })
    const chain = dispatcher.state.active[0]!
    expect(chain.paused).toBe(true)
    expect(chain.error?.code).toBe('slot.noneFree')
    expect(chain.slotWait).toBeUndefined()
    expect(log).toEqual([
      'chain: ABC paused: git: no slot is free, ABC-1 was not started; free one, then resume:\nthe slot D:/work/abc/.claude/worktrees/even-keel has uncommitted changes; commit or remove them: M src/app.ts',
    ])
  })

  it('pauses on any other launch error even when unattended', async () => {
    const { dispatcher } = await started({ refuse: {}, failLaunch: 'ABC-1' })
    expect(dispatcher.state.active[0]!.paused).toBe(true)
  })
})
