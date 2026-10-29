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

const openCheck = (extra: Partial<ReviewCheck> = {}): ReviewCheck => ({ state: { state: 'open', mergeable: true, head: 'abc1234' }, remarks: [], failed: [], ...extra })

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

  it.each(['start', 'resume'] as const)('retries the same refused mark on %s without touching its session', async (command) => {
    const { pulls, tries } = refusing()
    const { dispatcher, relays, stopped, launched } = await running({ reviews: pulls.deps })

    await dispatcher[command]('ABC')
    await dispatcher.idle()

    expect(tries.count).toBe(2)
    expect(pulls.opened).toMatchObject([{ task: 'ABC-1', session: { sessionId: 'old-session' } }])
    expect(dispatcher.state.reviews.ABC).toMatchObject([{ task: 'ABC-1', markAt: '2026-09-26T11:50:00.000Z' }])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, error: null, current: { task: 'ABC-2' } })
    expect(relays).toEqual([])
    expect(stopped).toEqual([])
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('pauses with the new cause when a retry fails and waits for another explicit retry', async () => {
    const { pulls, tries } = refusing()
    const { dispatcher, relays, stopped, launched } = await running({ reviews: pulls.deps })
    pulls.deps.open = async () => {
      tries.count++
      throw fail('review.noRemote', { project: 'ABC' })
    }

    dispatcher.resume('ABC')
    await dispatcher.idle()
    expect(tries.count).toBe(2)
    expect(dispatcher.state.active[0]).toMatchObject({
      paused: true,
      current: { task: 'ABC-1', sessionId: 'old-session' },
      error: { code: 'review.notOpened', cause: { code: 'review.noRemote' } },
    })

    dispatcher.check()
    await dispatcher.idle()
    expect(tries.count).toBe(2)
    expect(relays).toEqual([])
    expect(stopped).toEqual([])
    expect(launched).toEqual([])
  })

  it('waits for a new mark after Skip and Unskip replace the session, or Stop and Start adopt it', async () => {
    const { pulls, tries } = refusing()
    const { dispatcher, handoffs, live, relays } = await running({ reviews: pulls.deps })

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
    expect(relays).toMatchObject([{ kind: 'relay', reason: 'unskipped' }])

    const sessionId = dispatcher.state.active[0]!.current!.sessionId!
    live['ABC-1'] = sessionId
    handoffs['ABC-1'] = handoff(sessionId, MARK, '2026-09-26T12:10:00.000Z')
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

  /** ABC-1 marks on a branch with nothing to open; the tracker's next read shows what `complete` did. */
  async function nothingToOpen(complete: () => Promise<void> = async () => {}) {
    const pulls = forge()
    pulls.deps.open = async () => null
    const context = setup({ state: runningState(), live: { 'ABC-1': 'old-session' }, reviews: pulls.deps })
    context.handoffs['ABC-1'] = handoff('old-session')
    const completeOf = pulls.deps.complete
    pulls.deps.complete = async (project, id) => {
      await complete()
      await completeOf(project, id)
      context.tracker.ABC = [task('ABC-1', done), task('ABC-2')]
    }
    context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await context.dispatcher.idle()
    // The tracker's read after `complete` queues the chain's next step.
    await context.dispatcher.idle()
    return { ...context, pulls }
  }

  it('moves the task of a clean branch with nothing beyond main to done without a pull request, cleans up and goes on', async () => {
    const { dispatcher, pulls, finished, pulled, launched, relays, log } = await nothingToOpen()

    expect(pulls.completed).toEqual(['ABC-1'])
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(pulled['ABC-1']).toBeUndefined()
    expect(launched).toEqual(['ABC/ABC-2'])
    expect(relays).toEqual([])
    expect(dispatcher.state.reviews.ABC).toBeUndefined()
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, current: { task: 'ABC-2' } })
    expect(log).toEqual(
      expect.arrayContaining([
        'review: ABC-1: no pull request opened, its branch has nothing beyond main and its worktree is clean; the task is done',
        'review: ABC-1 is moved to done in the tracker',
      ]),
    )
  })

  it('pauses the chain on a task with nothing to open that the tracker would not move to done, and does not try again', async () => {
    const { dispatcher, pulls, launched, finished } = await nothingToOpen(async () => {
      throw new Error('Huly: the server answered HTTP 503')
    })

    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({
      paused: true,
      current: { task: 'ABC-1', sessionId: 'old-session' },
      error: { code: 'review.notCompleted', params: { task: 'ABC-1' }, cause: { code: 'text' } },
    })
    dispatcher.resume('ABC')
    await dispatcher.idle()
    expect(pulls.completed).toEqual([])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-1')

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('tells the session of a branch with nothing beyond main and work left uncommitted, and does not pause', async () => {
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

  it('polls only the pull requests of the project asked for, as the page\'s refresh does', async () => {
    let asked = 0
    const { dispatcher, pulls } = await opened(() => (asked++, openCheck({ state: { state: 'merged', mergeable: null, head: 'abc1234' } })))
    await dispatcher.pollReviews('XYZ')
    expect(asked).toBe(0)

    await dispatcher.pollReviews('ABC')
    expect(asked).toBe(1)
    expect(pulls.completed).toEqual(['ABC-1'])
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
    expect(dispatcher.state.reviews.ABC).toEqual([expect.objectContaining({ task: 'ABC-1', closed: 'unmerged', cleaned: true })])
    expect(dispatcher.orders().ABC?.reviews).toBeUndefined()
    expect(dispatcher.released('ABC')).not.toContain('ABC-1')
  })

  it('tells the next launch of a task whose pull request was closed unmerged of it and its remarks, once', async () => {
    const closing = () =>
      openCheck({
        state: { state: 'closed', mergeable: null, head: 'abc1234' },
        remarks: [{ key: 'comment:9', kind: 'comment', author: 'jane', body: 'Not this way, see the issue.', at: '2026-09-26T11:40:00.000Z', comments: [] }],
      })
    const { dispatcher, extras, launched, live, journal, log } = await opened(closing)
    delete live['ABC-1']
    await dispatcher.pollReviews()
    await dispatcher.idle()
    expect(log).toContain(`review: ABC-1: ${URL} is closed unmerged with 1 remark(s), the task is skipped`)

    dispatcher.unskip('ABC', 'ABC-1')
    await dispatcher.start('ABC')
    await dispatcher.idle()

    expect(launched).toEqual(['ABC/ABC-1'])
    expect(extras['ABC-1']).toContain(`Прошлый pull request этой задачи, ${URL}, закрыт без слияния.`)
    expect(extras['ABC-1']).toContain('Not this way, see the issue.')
    expect(journal.at(-1)).toMatchObject({ task: 'ABC-1', reason: 'review' })
    expect(dispatcher.state.reviews.ABC).toBeUndefined()
  })

  const changes = () =>
    openCheck({ remarks: [{ key: 'review:41', kind: 'changes', author: 'jane', body: 'Rename it.', at: '2026-09-26T11:55:00.000Z', comments: [{ path: 'src/a.ts', line: 3, body: 'here' }] }] })

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

  it('resumes a session whose cache a keep-warm ping read since its last answer', async () => {
    const opening = await opened(changes)
    const { handoffs, relays, clock } = opening
    handoffs['ABC-1'] = { ...handoffs['ABC-1']!, warmedAt: '2026-09-26T12:30:00.000Z' }
    clock.now = new Date('2026-09-26T13:00:00Z')
    await polledAndStarted(opening)

    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session' }])
  })

  it.each([
    ['12:10', 'reply'],
    ['12:30', 'relay'],
  ])("takes the session's own warm window, half an hour's cache at %s", async (time, kind) => {
    const opening = await opened(changes)
    const { handoffs, relays, clock } = opening
    handoffs['ABC-1'] = { ...handoffs['ABC-1']!, warmMs: 25 * 60_000 }
    clock.now = new Date(`2026-09-26T${time}:00Z`)
    await polledAndStarted(opening)

    expect(relays).toMatchObject([{ kind, task: 'ABC-1' }])
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

describe('Feedback on the pull request of a chain that ended', () => {
  /** The chain opens ABC-1's pull request; with `next` it goes on to ABC-2, else it runs out of tasks and ends by itself. */
  async function outForReview(next = false) {
    let check = openCheck()
    const pulls = forge(() => check)
    const context = setup({ state: runningState(), live: { 'ABC-1': 'old-session' }, reviews: pulls.deps })
    context.handoffs['ABC-1'] = handoff('old-session')
    context.dispatcher.setTasks('ABC', next ? [task('ABC-1'), task('ABC-2')] : [task('ABC-1')])
    await context.dispatcher.idle()
    expect(pulls.opened).toMatchObject([{ task: 'ABC-1' }])
    context.handoffs['ABC-1'] = handoff('old-session', null)
    const feedback = async () => {
      check = changes()
      await context.dispatcher.pollReviews()
      await context.dispatcher.idle()
    }
    return { ...context, feedback }
  }

  const changes = () =>
    openCheck({ remarks: [{ key: 'review:41', kind: 'changes', author: 'jane', body: 'Rename it.', at: '2026-09-26T12:05:00.000Z', comments: [] }] })

  it('starts the chain again on the task, which takes the feedback, when the chain ended by itself', async () => {
    const { dispatcher, relays, log, feedback } = await outForReview()
    expect(dispatcher.state.active).toEqual([])
    expect(log).toContain('chain: ABC ended, no task left to run')

    await feedback()
    expect(log).toContain('chain: ABC starts again: feedback came on a pull request of its tasks')
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-1')
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session' }])
    expect(relays[0]?.prompt).toContain('Rename it.')
  })

  it('leaves the chain stopped when the user stopped it, and the feedback waits for Start', async () => {
    const { dispatcher, relays, feedback } = await outForReview(true)
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-2')
    dispatcher.stop('ABC')

    await feedback()
    expect(dispatcher.state.active).toEqual([])
    expect(relays).toEqual([])
    expect(dispatcher.state.reviews.ABC![0]!.feedback).toContain('Rename it.')
  })

  it('leaves the chain stopped when the user started it again after it ended and stopped it then', async () => {
    const { dispatcher, launched, feedback } = await outForReview()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-2'])
    dispatcher.stop('ABC')

    await feedback()
    expect(dispatcher.state.active).toEqual([])
  })

  it('leaves a paused chain paused', async () => {
    const { dispatcher, relays, feedback } = await outForReview(true)
    dispatcher.state.active[0]!.paused = true

    await feedback()
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true })
    expect(relays).toEqual([])
  })

  it('queues the chain when as many chains run as are allowed, and taken off the queue it stays stopped', async () => {
    const { dispatcher, feedback } = await outForReview()
    dispatcher.state.active.push({ project: 'XYZ', current: null, paused: true, error: null })

    await feedback()
    expect(dispatcher.state.queue).toEqual(['ABC'])
    dispatcher.dequeue('ABC')
    expect(dispatcher.state.reviews.ABC![0]!.wakes).toBeUndefined()
  })
})
