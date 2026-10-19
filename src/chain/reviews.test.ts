import { describe, expect, it } from 'vitest'
import { fail } from '../notice/notice.js'
import type { PullRequest, ReviewCheck } from '../review/model.js'
import { PROMPTS } from './prompts.js'
import { done, setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { ReviewDeps } from './model.js'
import type { HandoffSession } from './relay.js'

const MARK = '.temp/pull-request.md'
const URL = 'https://github.com/john/abc/pull/7'

const handoff = (sessionId: string, pullRequest: string | null = MARK, lastReplyAt = '2026-09-26T11:50:00.000Z'): HandoffSession => ({
  sessionId,
  agentId: sessionId.slice(0, 8),
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/task',
  transcript: null,
  lastReplyAt,
  recent: [],
  lastMessage: `Done.\n\nPULL REQUEST: ${MARK}`,
  checkpoint: null,
  pullRequest,
})

const record = (extra: Partial<PullRequest> = {}): PullRequest => ({
  task: 'ABC-1',
  remote: 'origin',
  number: 7,
  url: URL,
  branch: 'abc-1/task',
  at: '2026-09-26T11:51:00.000Z',
  pushedAt: '2026-09-26T11:51:00.000Z',
  markAt: '2026-09-26T11:50:00.000Z',
  seen: [],
  ...extra,
})

const runningState = (reviews: PullRequest[] = []): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }],
  ...(reviews.length > 0 && { reviews: { ABC: reviews } }),
})

const openCheck = (extra: Partial<ReviewCheck> = {}): ReviewCheck => ({ state: { state: 'open', mergeable: true, head: 'abc1234' }, changes: [], failed: [], ...extra })

function forge(check: () => ReviewCheck = () => openCheck(), on = true) {
  const opened: { task: string; session: HandoffSession }[] = []
  const completed: string[] = []
  const deps: ReviewDeps = {
    on: () => on,
    open: async (_project, task, session) => {
      opened.push({ task, session })
      return { number: 7, url: URL, branch: 'abc-1/task', pushedAt: '2026-09-26T12:00:00.000Z', remote: 'origin' }
    },
    check: async () => check(),
    complete: async (_project, task) => {
      completed.push(task)
    },
  }
  return { deps, opened, completed }
}

async function running(options: SetupOptions = {}, session: HandoffSession | null = handoff('old-session'), reviews: PullRequest[] = []) {
  const context = setup({ state: runningState(reviews), live: { 'ABC-1': 'old-session' }, ...options })
  if (session !== null) context.handoffs['ABC-1'] = session
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
  return context
}

describe('Dispatcher in PR mode', () => {
  it('opens the pull request on the mark, takes the task out of the chain and starts the next one', async () => {
    const pulls = forge()
    const { dispatcher, launched, journal } = await running({ reviews: pulls.deps })

    expect(pulls.opened).toMatchObject([{ task: 'ABC-1', session: { sessionId: 'old-session', pullRequest: MARK } }])
    expect(dispatcher.state.reviews.ABC).toEqual([
      { task: 'ABC-1', remote: 'origin', number: 7, url: URL, branch: 'abc-1/task', at: '2026-09-26T12:00:00.000Z', pushedAt: '2026-09-26T12:00:00.000Z', markAt: '2026-09-26T11:50:00.000Z', seen: [] },
    ])
    expect(journal[0]).toEqual({ at: '2026-09-26T12:00:00.000Z', project: 'ABC', task: 'ABC-1', sessionId: 'old-session', reason: 'review' })
    expect(launched).toEqual(['ABC/ABC-2'])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-2')
    const order = dispatcher.orders().ABC!
    expect(order.order).toEqual(['ABC-2'])
    expect(order.backlog).toEqual([])
    expect(order.reviews).toEqual([{ task: 'ABC-1', number: 7, url: URL, feedback: false }])
  })

  it('keeps a task that waits on the pull request among the blockers of the tasks it blocks', async () => {
    const pulls = forge()
    const context = setup({ state: runningState(), live: { 'ABC-1': 'old-session' }, reviews: pulls.deps })
    context.handoffs['ABC-1'] = handoff('old-session')
    context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', undefined, 'ABC-1')])
    await context.dispatcher.idle()

    expect(context.launched).toEqual([])
    expect(context.dispatcher.orders().ABC).toMatchObject({ order: ['ABC-2'], waiting: ['ABC-1'] })
  })

  it('leaves the mark alone when the project is not in PR mode', async () => {
    const pulls = forge(undefined, false)
    const { dispatcher, launched } = await running({ reviews: pulls.deps })

    expect(pulls.opened).toEqual([])
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-1')
  })

  it('does not act on a session mid-turn, nor on a mark it acted on already', async () => {
    const busy = await running({ reviews: forge().deps, busy: new Set(['ABC-1']) })
    expect(busy.launched).toEqual([])

    const pulls = forge()
    const again = await running({ reviews: pulls.deps }, handoff('old-session'), [record({ feedback: 'fix it' })])
    expect(pulls.opened).toEqual([])
    expect(again.relays).toHaveLength(1)
  })

  /** The forge refuses the first opening; `tries` counts the attempts. */
  function refusing(error: Error = new Error('GitHub: the API answered HTTP 422')) {
    const pulls = forge()
    const open = pulls.deps.open
    const tries = { count: 0 }
    pulls.deps.open = async (project, task, session) => {
      if (++tries.count === 1) throw error
      return open(project, task, session)
    }
    return { pulls, tries }
  }

  it('pauses the chain on the task when the pull request cannot be opened, the task staying current', async () => {
    const { pulls } = refusing()
    const { dispatcher, launched } = await running({ reviews: pulls.deps })

    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({
      paused: true,
      current: { task: 'ABC-1', sessionId: 'old-session' },
      error: { code: 'review.notOpened', params: { task: 'ABC-1' }, cause: { code: 'text' } },
    })
    expect(dispatcher.state.reviews.ABC).toBeUndefined()
  })

  it('does not try a refused mark again on Resume, Skip and Unskip or Stop and Start, only a new turn', async () => {
    const { pulls, tries } = refusing()
    const { dispatcher, handoffs } = await running({ reviews: pulls.deps })

    dispatcher.resume('ABC')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-1')
    dispatcher.unskip('ABC', 'ABC-1')
    await dispatcher.idle()
    dispatcher.stop('ABC')
    await dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-1')
    expect(tries.count).toBe(1)

    handoffs['ABC-1'] = handoff('old-session', MARK, '2026-09-26T12:10:00.000Z')
    dispatcher.check()
    await dispatcher.idle()
    expect(tries.count).toBe(2)
    expect(dispatcher.state.reviews.ABC).toMatchObject([{ task: 'ABC-1', markAt: '2026-09-26T12:10:00.000Z' }])
  })

  it('takes the chat answer to the session of the task it paused on and opens its next mark at once', async () => {
    const { pulls, tries } = refusing()
    const { dispatcher, relays, handoffs } = await running({ reviews: pulls.deps })

    dispatcher.answer('ABC', 'ABC-1', 'old-session', null, 'Commit it and mark again.')
    await dispatcher.idle()
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session', prompt: 'Commit it and mark again.' }])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, error: null, current: { task: 'ABC-1' } })

    handoffs['ABC-1'] = handoff('old-session', MARK, '2026-09-26T12:10:00.000Z')
    dispatcher.check()
    await dispatcher.idle()
    expect(tries.count).toBe(2)
    expect(dispatcher.state.reviews.ABC).toHaveLength(1)
  })

  it('tells the session of a branch with nothing beyond main instead of opening, and does not pause', async () => {
    const pulls = forge()
    pulls.deps.open = async () => {
      throw fail('review.nothingAhead', { branch: 'abc-1/task', base: 'main' })
    }
    const { dispatcher, relays, log, launched } = await running({ reviews: pulls.deps })

    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session' }])
    expect(relays[0]?.prompt).toBe(PROMPTS.ru.review.nothingAhead('main'))
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, current: { task: 'ABC-1' } })
    expect(dispatcher.state.reviews.ABC).toBeUndefined()
    expect(launched).toEqual([])
    expect(log).toContain('review: ABC-1: no pull request opened, abc-1/task has no commits beyond main; the session is told')

    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toHaveLength(1)
  })

  it('opens the mark a session left while its chain was stopped once the chain starts again', async () => {
    const pulls = forge()
    const context = setup({ live: { 'ABC-1': 'old-session' }, reviews: pulls.deps })
    context.handoffs['ABC-1'] = handoff('old-session')
    context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await context.dispatcher.idle()
    expect(pulls.opened).toEqual([])

    await context.dispatcher.start('ABC')
    await context.dispatcher.idle()
    context.dispatcher.check()
    await context.dispatcher.idle()
    expect(pulls.opened).toMatchObject([{ task: 'ABC-1' }])
    expect(context.launched).toEqual(['ABC/ABC-2'])
  })
})

describe('Dispatcher polling pull requests', () => {
  /** ABC-1 waits on its pull request; the chain ran out of tasks and ended. */
  async function opened(check: () => ReviewCheck, options: SetupOptions = {}) {
    const pulls = forge(check)
    const context = setup({ state: { ...emptyChainState(), reviews: { ABC: [record()] }, released: { ABC: ['ABC-1'] } }, live: { 'ABC-1': 'old-session' }, reviews: pulls.deps, ...options })
    context.handoffs['ABC-1'] = handoff('old-session', null)
    context.dispatcher.setTasks('ABC', [task('ABC-1')])
    await context.dispatcher.idle()
    return { ...context, pulls }
  }

  /** Feedback does not start a chain: the user does. */
  async function polledAndStarted(context: Awaited<ReturnType<typeof opened>>) {
    await context.dispatcher.pollReviews()
    expect(context.dispatcher.state.active).toEqual([])
    await context.dispatcher.start('ABC')
    await context.dispatcher.idle()
  }

  it('completes the task of a merged pull request and cleans up after it with the branch forced off the remote', async () => {
    const { dispatcher, pulls, finished, pulled, log } = await opened(() => openCheck({ state: { state: 'merged', mergeable: null, head: 'abc1234' } }))
    await dispatcher.pollReviews()

    expect(pulls.completed).toEqual(['ABC-1'])
    expect(log).toEqual(expect.arrayContaining([`review: ABC-1: ${URL} is merged`, 'review: ABC-1 is moved to done in the tracker']))
    expect(dispatcher.state.reviews.ABC![0]!.closed).toBe('merged')
    expect(dispatcher.released('ABC')).toContain('ABC-1')

    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toContain('ABC/ABC-1')
    expect(pulled['ABC-1']).toEqual({ force: true, remote: 'origin' })
    expect(dispatcher.state.reviews.ABC).toBeUndefined()
  })

  it('tells in the log a task done in the tracker before a poll saw its pull request merged', async () => {
    const { dispatcher, finished, log } = await opened(() => openCheck())
    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()

    expect(finished).toContain('ABC/ABC-1')
    expect(log).toContain(`review: ABC-1 is done in the tracker, its pull request ${URL} is not followed any more`)
    expect(dispatcher.state.reviews.ABC).toBeUndefined()
  })

  it('skips the task of a pull request closed unmerged and drops its branch without archiving it', async () => {
    const { dispatcher, finished, pulled } = await opened(() => openCheck({ state: { state: 'closed', mergeable: null, head: 'abc1234' } }))
    await dispatcher.pollReviews()
    await dispatcher.idle()

    expect(dispatcher.state.skipped.ABC).toEqual(['ABC-1'])
    expect(finished).toContain('ABC/ABC-1')
    expect(pulled['ABC-1']).toEqual({ force: true, remote: 'origin', unmerged: true })
    expect(dispatcher.state.reviews.ABC).toBeUndefined()
    expect(dispatcher.released('ABC')).not.toContain('ABC-1')
  })

  const changes = () =>
    openCheck({ changes: [{ id: '41', author: 'jane', body: 'Rename it.', at: '2026-09-26T11:55:00.000Z', comments: [{ path: 'src/a.ts', line: 3, body: 'here' }] }] })

  it('resumes the warm session of the task with the feedback and remembers the review as seen', async () => {
    const opening = await opened(changes)
    const { dispatcher: context, relays, journal } = opening
    await polledAndStarted(opening)

    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session' }])
    expect(relays[0]?.prompt).toContain(URL)
    expect(relays[0]?.prompt).toContain('Rename it.')
    expect(journal.at(-1)).toMatchObject({ task: 'ABC-1', reason: 'review', previous: 'old-session' })
    const pull = context.state.reviews.ABC![0]!
    expect(pull.seen).toEqual(['review:41'])
    expect(pull.feedback).toBeUndefined()
    expect(context.state.active[0]?.current?.task).toBe('ABC-1')
  })

  it('hands the task over to a new session with the feedback once the cache is cold', async () => {
    const opening = await opened(changes)
    const { relays, clock } = opening
    clock.now = new Date('2026-09-26T13:00:00Z')
    await polledAndStarted(opening)

    expect(relays).toMatchObject([{ kind: 'relay', task: 'ABC-1', reason: 'review' }])
    expect(relays[0]?.prompt).toContain('Rename it.')
    expect(relays[0]?.prompt).toContain('PULL REQUEST:')
  })

  it('starts a new session with the feedback when the task has none', async () => {
    const opening = await opened(changes)
    const { dispatcher, extras, launched, live, journal } = opening
    delete live['ABC-1']
    await polledAndStarted(opening)

    expect(launched).toEqual(['ABC/ABC-1'])
    expect(extras['ABC-1']).toContain('Rename it.')
    expect(journal.at(-1)).toMatchObject({ task: 'ABC-1', reason: 'review' })
    expect(dispatcher.state.reviews.ABC![0]!.feedback).toBeUndefined()
  })

  it('delivers the feedback again when a service restart cut its delivery short', async () => {
    const state = runningState([record()])
    state.active[0]!.current = { ...state.active[0]!.current!, starting: '2026-09-26T11:58:00.000Z', move: 'review', answering: true, reply: 'Rename it.' }
    const context = setup({ state, live: { 'ABC-1': 'old-session' }, reviews: forge().deps })
    context.handoffs['ABC-1'] = handoff('old-session', null)
    context.dispatcher.setTasks('ABC', [task('ABC-1')])
    await context.dispatcher.idle()

    expect(context.relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', prompt: 'Rename it.' }])
    expect(context.journal.at(-1)).toMatchObject({ reason: 'review' })
  })

  it('tells the session of a feedback only once', async () => {
    const opening = await opened(changes)
    const { dispatcher, relays, saved } = opening
    await polledAndStarted(opening)
    const before = saved.length
    await dispatcher.pollReviews()
    await dispatcher.idle()

    expect(relays.filter((relay) => relay.kind === 'reply')).toHaveLength(1)
    expect(saved).toHaveLength(before)
  })
})
