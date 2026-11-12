import { describe, expect, it } from 'vitest'
import { textNotice } from '../notice/notice.js'
import { done, setup, task, type SetupOptions } from './dispatcher.fixture.js'
import type { UnchangedDeps } from './model.js'
import type { HandoffSession } from './relay.js'

const session = (sessionId: string, lastMessage: string, noChanges: string | null): HandoffSession => ({
  sessionId,
  agentId: sessionId,
  account: 'global',
  cwd: 'D:/work/notes',
  workdir: 'D:/work/notes',
  branch: null,
  transcript: null,
  lastReplyAt: '2026-09-26T12:00:30.000Z',
  recent: [],
  lastMessage,
  checkpoint: null,
  noChanges,
})

const marked = (sessionId = 'session-1') => session(sessionId, 'Found it.\n\nTASK DONE', '')

function plain(options: SetupOptions = {}) {
  const accepted: string[] = []
  const tracker = { down: false }
  const unchanged: UnchangedDeps = {
    changes: async () => ({ ahead: 0, files: 0 }),
    complete: async () => undefined,
    accept: async (_project, id) => {
      if (tracker.down) throw textNotice('the tracker is down')
      accepted.push(id)
    },
  }
  const context = setup({ plain: true, unchanged, ...options })
  context.tracker.ABC = [task('ABC-1', done), task('ABC-2')]
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  return { ...context, accepted, tracker }
}

async function settled(dispatcher: { idle: () => Promise<void> }): Promise<void> {
  // The tracker's read after the close queues the chain's next step.
  await dispatcher.idle()
  await dispatcher.idle()
}

describe('Dispatcher stopping after the turn in a project without git (BTN-1044)', () => {
  it('closes the task by the mark its turn ended with, then stops without the next task', async () => {
    const busy = new Set<string>(['ABC-1'])
    const { dispatcher, launched, finished, accepted, handoffs } = plain({ busy })
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.stopAfter('ABC', true)
    await dispatcher.idle()
    expect(accepted).toEqual([])

    handoffs['ABC-1'] = marked()
    busy.clear()
    dispatcher.check()
    await settled(dispatcher)

    expect(accepted).toEqual(['ABC-1'])
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toEqual([])
    expect(dispatcher.state.released.ABC ?? []).toEqual([])
  })

  it('closes by the mark of a turn that had ended before the stop was asked', async () => {
    const { dispatcher, launched, accepted, handoffs } = plain()
    dispatcher.start('ABC')
    await dispatcher.idle()
    handoffs['ABC-1'] = marked()

    dispatcher.stopAfter('ABC', true)
    await settled(dispatcher)

    expect(accepted).toEqual(['ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toEqual([])
  })

  it('stops and leaves the task open when the turn ended without the mark', async () => {
    const busy = new Set<string>(['ABC-1'])
    const { dispatcher, launched, accepted, handoffs } = plain({ busy })
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.stopAfter('ABC', true)

    handoffs['ABC-1'] = session('session-1', 'Which source do I trust?', null)
    busy.clear()
    dispatcher.check()
    await settled(dispatcher)

    expect(accepted).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toEqual([])
    expect(dispatcher.state.released.ABC).toEqual(['ABC-1'])
  })

  it('pauses on the task when the tracker refuses the comment, and closes it on Resume', async () => {
    const { dispatcher, launched, accepted, handoffs, tracker } = plain()
    dispatcher.start('ABC')
    await dispatcher.idle()
    handoffs['ABC-1'] = marked()
    tracker.down = true

    dispatcher.stopAfter('ABC', true)
    await settled(dispatcher)
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, current: { task: 'ABC-1' }, error: { code: 'chain.unchangedNotCompleted' } })

    tracker.down = false
    dispatcher.resume('ABC')
    await settled(dispatcher)
    expect(accepted).toEqual(['ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toEqual([])
  })

  it('leaves a project with git as it was: the mark is not followed', async () => {
    const { dispatcher, accepted, handoffs } = plain({ plain: false })
    dispatcher.start('ABC')
    await dispatcher.idle()
    handoffs['ABC-1'] = marked()

    dispatcher.stopAfter('ABC', true)
    await settled(dispatcher)
    expect(accepted).toEqual([])
    expect(dispatcher.state.active).toEqual([])
    expect(dispatcher.state.released.ABC).toEqual(['ABC-1'])
  })
})

describe('Dispatcher asked to stop after the turn right after a launch (BTN-1044)', () => {
  it('waits for a session it has just launched and that is not seen working yet', async () => {
    const busy = new Set<string>()
    const { dispatcher, launched, accepted, handoffs } = plain({ busy })
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.stopAfter('ABC', true)
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-1' }, stopAfter: true })

    busy.add('ABC-1')
    dispatcher.check()
    await dispatcher.idle()
    handoffs['ABC-1'] = marked()
    busy.clear()
    dispatcher.check()
    await settled(dispatcher)
    expect(accepted).toEqual(['ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toEqual([])
  })

  it('does not wait past a minute for a session that never showed up', async () => {
    const { dispatcher, clock } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.stopAfter('ABC', true)
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.stopAfter).toBe(true)

    clock.now = new Date(clock.now.getTime() + 61_000)
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
  })

  it('stops at once on a launched session that waits on a question', async () => {
    const waiting = new Set<string>(['ABC-1'])
    const { dispatcher } = setup({ waiting })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.stopAfter('ABC', true)
    expect(dispatcher.state.active).toEqual([])
  })
})

describe('Dispatcher starting on a task whose last session ended with the mark (BTN-1044)', () => {
  it('closes the task by the mark of the finished session instead of launching a new one', async () => {
    const { dispatcher, launched, accepted, handoffs } = plain()
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.stop('ABC')
    await dispatcher.idle()
    handoffs['ABC-1'] = marked()

    dispatcher.start('ABC')
    await settled(dispatcher)
    await settled(dispatcher)
    expect(accepted).toEqual(['ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('launches anew when the marked session is not the one the chain launched last', async () => {
    const { dispatcher, launched, accepted, handoffs } = plain()
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.stop('ABC')
    await dispatcher.idle()
    handoffs['ABC-1'] = marked('someone-elses')

    dispatcher.start('ABC')
    await settled(dispatcher)
    expect(accepted).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-1'])
  })

  it('launches anew when the last turn of the finished session carries no mark', async () => {
    const { dispatcher, launched, accepted, handoffs } = plain()
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.stop('ABC')
    await dispatcher.idle()
    handoffs['ABC-1'] = session('session-1', 'Stopped half way.', null)

    dispatcher.start('ABC')
    await settled(dispatcher)
    expect(accepted).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-1'])
  })
})
