import { describe, expect, it } from 'vitest'
import type { Changes } from '../git/types.js'
import { textNotice, fail } from '../notice/notice.js'
import { MESSAGE_LIMIT } from '../sessions/transcript.js'
import { done, setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { ReviewDeps, UnchangedDeps } from './model.js'
import { PROMPTS } from './prompts.js'
import type { HandoffSession } from './relay.js'

const REASON = 'hello.txt is already in main, commit 1a5e222'

const handoff = (noChanges: string | null = REASON): HandoffSession => ({
  sessionId: 'old-session',
  agentId: 'old-sess',
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/task',
  transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z',
  recent: [],
  lastMessage: `Nothing to do.\n\nNO CHANGES: ${REASON}`,
  checkpoint: null,
  noChanges,
})

const runningState = (): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }],
})

function tracker(changes: () => Changes = () => ({ ahead: 0, files: 0 })) {
  const looked: string[] = []
  const completed: { task: string; comment: string }[] = []
  const deps: UnchangedDeps = {
    changes: async (_project, workdir) => {
      looked.push(workdir)
      return changes()
    },
    complete: async (_project, task, comment) => {
      completed.push({ task, comment })
    },
  }
  return { deps, looked, completed }
}

async function running(unchanged: UnchangedDeps, session: HandoffSession = handoff(), options: SetupOptions = {}) {
  const context = setup({ state: runningState(), live: { 'ABC-1': 'old-session' }, unchanged, ...options })
  context.handoffs['ABC-1'] = session
  context.tracker.ABC = [task('ABC-1', done), task('ABC-2')]
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
  // The tracker's read after `complete` queues the chain's next step.
  await context.dispatcher.idle()
  return context
}

describe('Dispatcher on a task marked NO CHANGES', () => {
  it('moves a task with a clean branch to done with the reason as a comment, cleans up and starts the next one', async () => {
    const marks = tracker()
    const { dispatcher, launched, finished, refreshed, relays, log } = await running(marks.deps)

    expect(marks.looked).toEqual(['D:/work/abc/.claude/worktrees/abc-1'])
    expect(marks.completed).toEqual([{ task: 'ABC-1', comment: PROMPTS.ru.unchanged.comment(REASON) }])
    expect(refreshed).toContain('ABC')
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-2'])
    expect(relays).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, current: { task: 'ABC-2' } })
    expect(log).toContain('chain: ABC-1 needs no change and its branch has nothing beyond main; the task is done')
  })

  it('puts the comment without a reason when the mark gives none', async () => {
    const marks = tracker()
    await running(marks.deps, handoff(''))
    expect(marks.completed).toEqual([{ task: 'ABC-1', comment: PROMPTS.ru.unchanged.comment('') }])
  })

  it('tells the session of a branch with commits beyond main, once, and does not pause', async () => {
    const marks = tracker(() => ({ ahead: 2, files: 0 }))
    const { dispatcher, relays, launched, log } = await running(marks.deps)

    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session', prompt: PROMPTS.ru.unchanged.ahead('main') }])
    expect(marks.completed).toEqual([])
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, current: { task: 'ABC-1' } })
    expect(log).toContain('chain: ABC-1 is marked as needing no change, but its branch has 2 commit(s) beyond main; the session is told')

    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toHaveLength(1)
  })

  it('tells the session of work left out of a commit', async () => {
    const marks = tracker(() => ({ ahead: 0, files: 4 }))
    const { relays } = await running(marks.deps)
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', prompt: PROMPTS.ru.unchanged.dirty('main') }])
    expect(marks.completed).toEqual([])
  })

  it('pauses on the task when the tracker does not move it to done', async () => {
    const marks = tracker()
    marks.deps.complete = async () => {
      throw new Error('socket closed')
    }
    const { dispatcher, launched } = await running(marks.deps)
    expect(dispatcher.state.active[0]).toMatchObject({
      paused: true,
      current: { task: 'ABC-1', sessionId: 'old-session' },
      error: { code: 'chain.unchangedNotCompleted', params: { task: 'ABC-1' } },
    })
    expect(launched).toEqual([])
  })

  it('pauses on the task when its folder cannot be checked', async () => {
    const marks = tracker(() => {
      throw fail('git.failed', { step: 'countCommits', subject: 'main', repo: 'D:/work/abc' })
    })
    const { dispatcher } = await running(marks.deps)
    expect(dispatcher.state.active[0]).toMatchObject({
      paused: true,
      current: { task: 'ABC-1' },
      error: { code: 'chain.unchangedNotChecked', params: { task: 'ABC-1' }, cause: { code: 'git.failed' } },
    })
    expect(marks.completed).toEqual([])
  })

  it('does not wait for a session whose turn ended on a background command', async () => {
    const marks = tracker()
    const { launched, finished } = await running(marks.deps, handoff(), { shell: new Set(['ABC-1']) })
    expect(marks.completed).toEqual([{ task: 'ABC-1', comment: PROMPTS.ru.unchanged.comment(REASON) }])
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('waits for a session in a background command whose branch holds work, then tells it', async () => {
    const marks = tracker(() => ({ ahead: 1, files: 0 }))
    const { dispatcher, relays, shell } = await running(marks.deps, handoff(), { shell: new Set(['ABC-1']) })
    expect(relays).toEqual([])
    expect(marks.completed).toEqual([])

    shell.delete('ABC-1')
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', prompt: PROMPTS.ru.unchanged.ahead('main') }])
  })

  it('leaves alone a session without the mark, one at work and one of a project in PR mode', async () => {
    const plain = tracker()
    const unmarked = await running(plain.deps, handoff(null))
    expect(plain.looked).toEqual([])
    expect(unmarked.relays).toEqual([])

    const working = tracker()
    await running(working.deps, handoff(), { busy: new Set(['ABC-1']) })
    expect(working.looked).toEqual([])

    const reviewed = tracker()
    const forge: ReviewDeps = {
      on: () => true,
      open: async () => null,
      check: async () => {
        throw textNotice('not polled')
      },
      complete: async () => undefined,
    }
    const { launched } = await running(reviewed.deps, handoff(), { reviews: forge })
    expect(reviewed.looked).toEqual([])
    expect(launched).toEqual([])
  })
})

describe('Dispatcher on a marked task of a project without git', () => {
  const answering = () => {
    const accepted: { task: string; comment: string }[] = []
    const marks = tracker()
    const deps: UnchangedDeps = {
      ...marks.deps,
      accept: async (_project, task, comment) => {
        accepted.push({ task, comment })
      },
    }
    return { deps, accepted, marks }
  }
  const answer = (lastMessage: string, noChanges = ''): HandoffSession => ({ ...handoff(noChanges), workdir: 'D:/work/notes', branch: null, lastMessage })

  it('puts the whole last message without the mark on the task, closes it without asking git and starts the next one', async () => {
    const { deps, accepted, marks } = answering()
    const { launched, finished, log } = await running(deps, answer('Three sources agree.\n\n- one\n- two\n\nTASK DONE'), { plain: true })

    expect(marks.looked).toEqual([])
    expect(marks.completed).toEqual([])
    expect(accepted).toEqual([{ task: 'ABC-1', comment: PROMPTS.ru.unchanged.answered('Three sources agree.\n\n- one\n- two', false) }])
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-2'])
    expect(log).toContain('chain: ABC-1 is marked as done by its session; its last message goes on the task and the task is done')
  })

  it('comments the summary of a message that is only the mark, and says so of a mark alone', async () => {
    const summed = answering()
    await running(summed.deps, answer('TASK DONE: the note is in notes/found.md', 'the note is in notes/found.md'), { plain: true })
    expect(summed.accepted[0]!.comment).toBe(PROMPTS.ru.unchanged.answered('the note is in notes/found.md', false))

    const bare = answering()
    await running(bare.deps, answer('TASK DONE'), { plain: true })
    expect(bare.accepted[0]!.comment).toBe(PROMPTS.ru.unchanged.answered('', false))
  })

  it('notes a message cut at the kept length', async () => {
    const { deps, accepted } = answering()
    const long = 'a'.repeat(MESSAGE_LIMIT)
    await running(deps, answer(long), { plain: true })
    expect(accepted[0]!.comment).toBe(PROMPTS.ru.unchanged.answered(long, true))
    expect(accepted[0]!.comment).toContain('Ответ обрезан')
  })

  it('pauses the chain on its task when the comment does not reach the tracker', async () => {
    const { deps } = answering()
    deps.accept = async () => {
      throw textNotice('the tracker is down')
    }
    const { dispatcher, launched, finished } = await running(deps, answer('Found.\n\nTASK DONE'), { plain: true })
    expect(finished).toEqual([])
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, current: { task: 'ABC-1' }, error: { code: 'chain.unchangedNotCompleted' } })
  })
})
