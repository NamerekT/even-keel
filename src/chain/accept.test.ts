import { describe, expect, it } from 'vitest'
import type { Changes } from '../git/types.js'
import { fail, NoticeError } from '../notice/notice.js'
import { done, setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { UnchangedDeps } from './model.js'
import { PROMPTS } from './prompts.js'
import type { HandoffSession } from './relay.js'

const ANSWER = 'The library supports both formats.\n\nDetails are in the task description.'

const handoff = (lastMessage: string | null = ANSWER): HandoffSession => ({
  sessionId: 'old-session',
  agentId: 'old-sess',
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/task',
  transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z',
  recent: [],
  lastMessage,
  checkpoint: null,
  noChanges: null,
})

const runningState = (): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }],
})

function tracker(changes: () => Changes = () => ({ ahead: 0, files: 0 })) {
  const looked: string[] = []
  const accepted: { task: string; comment: string }[] = []
  const deps: UnchangedDeps = {
    changes: async (_project, workdir) => {
      looked.push(workdir)
      return changes()
    },
    complete: async () => {
      throw new Error('not a NO CHANGES mark')
    },
    accept: async (_project, task, comment) => {
      accepted.push({ task, comment })
    },
  }
  return { deps, looked, accepted }
}

async function running(unchanged: UnchangedDeps, session: HandoffSession = handoff(), options: SetupOptions = {}) {
  const context = setup({ state: runningState(), live: { 'ABC-1': 'old-session' }, unchanged, ...options })
  context.handoffs['ABC-1'] = session
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
  return context
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(NoticeError)
  return (error as NoticeError).notice
}

describe('Dispatcher.accept: the last message taken as the answer (BTN-885)', () => {
  it('comments the last message, moves the task to done, cleans up and starts the next one', async () => {
    const marks = tracker()
    const context = await running(marks.deps)
    const { dispatcher, launched, finished, refreshed, relays, log } = context
    expect(launched).toEqual([])

    context.tracker.ABC = [task('ABC-1', done), task('ABC-2')]
    await dispatcher.accept('ABC', 'ABC-1', 'old-session')
    await dispatcher.idle()
    await dispatcher.idle()

    expect(marks.looked).toEqual(['D:/work/abc/.claude/worktrees/abc-1'])
    expect(marks.accepted).toEqual([{ task: 'ABC-1', comment: PROMPTS.ru.unchanged.accepted(ANSWER) }])
    expect(refreshed).toContain('ABC')
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-2'])
    expect(relays).toEqual([])
    expect(log).toContain('chain: ABC-1: the user accepted the last message of its session old-session as the answer; the task is done')

    // A second press does not comment the answer again.
    expect(await refusal(dispatcher.accept('ABC', 'ABC-1', 'old-session'))).toMatchObject({ code: 'accept.closed' })
    expect(marks.accepted).toHaveLength(1)
  })

  it('refuses a branch with commits beyond main or uncommitted work, touching nothing', async () => {
    const ahead = tracker(() => ({ ahead: 2, files: 0 }))
    const first = await running(ahead.deps)
    expect(await refusal(first.dispatcher.accept('ABC', 'ABC-1', 'old-session'))).toMatchObject({
      code: 'accept.ahead',
      params: { task: 'ABC-1', count: 2, main: 'main' },
    })
    expect(ahead.accepted).toEqual([])
    expect(first.relays).toEqual([])
    expect(first.dispatcher.state.active[0]).toMatchObject({ paused: false, current: { task: 'ABC-1' } })

    const dirty = tracker(() => ({ ahead: 0, files: 3 }))
    const second = await running(dirty.deps)
    expect(await refusal(second.dispatcher.accept('ABC', 'ABC-1', 'old-session'))).toMatchObject({
      code: 'accept.dirty',
      params: { task: 'ABC-1', count: 3 },
    })
    expect(dirty.accepted).toEqual([])
  })

  it('refuses a session at work, one waiting on a question, one with no message and one the user did not see', async () => {
    const busy = tracker()
    const working = await running(busy.deps, handoff(), { busy: new Set(['ABC-1']) })
    expect(await refusal(working.dispatcher.accept('ABC', 'ABC-1', 'old-session'))).toMatchObject({ code: 'chain.midTurn' })

    const asking = await running(tracker().deps, handoff(), { asked: { 'ABC-1': 'ask-1' } })
    expect(await refusal(asking.dispatcher.accept('ABC', 'ABC-1', 'old-session'))).toMatchObject({ code: 'accept.asking' })

    const silent = await running(tracker().deps, handoff('  '))
    expect(await refusal(silent.dispatcher.accept('ABC', 'ABC-1', 'old-session'))).toMatchObject({ code: 'accept.noMessage' })

    const moved = await running(tracker().deps)
    expect(await refusal(moved.dispatcher.accept('ABC', 'ABC-1', 'another-session'))).toMatchObject({ code: 'answer.moved' })
    expect(await refusal(moved.dispatcher.accept('ABC', 'ABC-2', 'old-session'))).toMatchObject({ code: 'chain.notCurrent' })
    expect(busy.looked).toEqual([])
  })

  it('reports a folder git cannot read and a tracker that refuses, without pausing the chain', async () => {
    const broken = tracker(() => {
      throw fail('git.failed', { step: 'countCommits', subject: 'main', repo: 'D:/work/abc' })
    })
    const first = await running(broken.deps)
    expect(await refusal(first.dispatcher.accept('ABC', 'ABC-1', 'old-session'))).toMatchObject({
      code: 'accept.notChecked',
      cause: { code: 'git.failed' },
    })

    const refused = tracker()
    refused.deps.accept = async () => {
      throw new Error('socket closed')
    }
    const second = await running(refused.deps)
    expect(await refusal(second.dispatcher.accept('ABC', 'ABC-1', 'old-session'))).toMatchObject({ code: 'accept.notCompleted' })
    expect(second.dispatcher.state.active[0]).toMatchObject({ paused: false, current: { task: 'ABC-1', sessionId: 'old-session' } })
    expect(second.launched).toEqual([])

    // The chain goes on after a refusal: a later step still runs.
    second.dispatcher.check()
    await second.dispatcher.idle()
  })
})
