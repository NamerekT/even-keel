import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { commitAndMerge } from './agent.fixture.js'
import { FEED_ID, FEED_KEY, Harness, PROJECT_ID } from './service.fixture.js'

describe('the built-in tracker end to end', { timeout: 120_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const statusOf = async (number: number) => (await new BuiltinStore(run.service.db).get({ project: PROJECT_ID, number }))?.status.name

  it('runs two tasks filed through the page, the second after the first that blocks it, each moved and closed by the chain', async () => {
    run.project.tracker = 'builtin'
    for (const task of ['ABC-1', 'ABC-2']) run.agent.script(task, commitAndMerge(`${task}.txt`))
    await run.start()
    await run.post('builtin/create', { project: PROJECT_ID, title: 'Blocked' })
    await run.post('builtin/create', { project: PROJECT_ID, title: 'Blocker' })
    await run.post('builtin/relate', { task: 'ABC-2', other: 'ABC-1', kind: 'blocks' })
    await run.startChain(PROJECT_ID)

    let last: string | undefined
    await run.until(() => {
      void statusOf(1).then((status) => (last = status))
      return last === 'Done'
    }, 'ABC-1 done')

    const launches = run.agent.calls.filter((call) => call.kind === 'launch').map((call) => call.task)
    expect(launches).toEqual(['ABC-2', 'ABC-1'])
    expect(await statusOf(2)).toBe('Done')
    expect(run.git('log', '--format=%s', 'main').split('\n')).toEqual(expect.arrayContaining(['[ABC-1] Work', '[ABC-2] Work']))
  })

  it('a session splits its task through the tasks server: the chain runs the blocker, then the subtask, then closes the parent (BTN-768)', async () => {
    run.project.tracker = 'builtin'
    let created = ''
    run.agent.script('ABC-1', async ({ tool }) => {
      created = await tool('tasks', 'tasks_create', {
        tasks: [
          { title: 'Subtask', parent: 'ABC-1', status: 'Todo' },
          { title: 'Blocker', status: 'Todo', blocks: ['#1'] },
        ],
        retry: 'split-1',
      })
      return { say: 'split into ABC-2 and ABC-3' }
    })
    for (const task of ['ABC-2', 'ABC-3']) run.agent.script(task, commitAndMerge(`${task}.txt`))
    await run.start()
    await run.post('builtin/create', { project: PROJECT_ID, title: 'Feature' })
    await run.post('packages/server', { name: 'tasks', server: { type: 'http', url: 'http://127.0.0.1:4748/tasks' }, project: PROJECT_ID })
    await run.until(() => run.service.packages.unready(PROJECT_ID).length === 0, 'the tasks package installed')
    await run.startChain(PROJECT_ID)

    let last: string | undefined
    await run.until(() => {
      void statusOf(2).then((status) => (last = status))
      return last === 'Done'
    }, 'ABC-2 done')

    expect(created).toBe('ABC-2 Subtask\nABC-3 Blocker')
    const launches = run.agent.calls.filter((call) => call.kind === 'launch').map((call) => call.task)
    expect(launches).toEqual(['ABC-1', 'ABC-3', 'ABC-2'])
    expect(run.agent.calls.find((call) => call.task === 'ABC-1')!.prompt).toContain('Feature')
    expect(await statusOf(3)).toBe('Done')
    await run.until(() => {
      void statusOf(1).then((status) => (last = status))
      return last === 'Done'
    }, 'ABC-1 closed after its subtask')
  })

  it("a session on a feed's task comments and files its blocker in the feed, lists both trackers and is refused a link across them (BTN-892)", async () => {
    run.project.tracker = 'builtin'
    run.project.feeds = [{ id: FEED_ID, tracker: 'builtin', key: FEED_KEY }]
    const said: Record<string, string> = {}
    run.agent.script('GHI-1', async (context) => {
      const { tool } = context
      said.comment = await tool('tasks', 'task_comment', { key: 'GHI-1', text: 'Feed work done' })
      said.blocker = await tool('tasks', 'tasks_create', { tasks: [{ title: 'Feed blocker', blocks: ['GHI-1'] }], retry: 'feed-1' })
      said.list = await tool('tasks', 'tasks_list', { status: ['all'] })
      said.cross = await tool('tasks', 'tasks_create', { tasks: [{ title: 'Across', blocks: ['ABC-1'] }] }).catch((error: unknown) => (error as Error).message)
      return commitAndMerge('GHI-1.txt')(context)
    })
    run.agent.script('ABC-1', commitAndMerge('ABC-1.txt'))
    await run.start()
    const store = new BuiltinStore(run.service.db)
    await run.post('builtin/create', { project: PROJECT_ID, title: 'Main task' })
    await store.create({ project: FEED_ID, title: 'Feed task' })
    await run.post('packages/server', { name: 'tasks', server: { type: 'http', url: 'http://127.0.0.1:4748/tasks' }, project: PROJECT_ID })
    await run.until(() => run.service.packages.unready(PROJECT_ID).length === 0, 'the tasks package installed')
    await run.startChain(PROJECT_ID)

    let last: string | undefined
    await run.until(() => {
      void store.get({ project: FEED_ID, number: 1 }).then((task) => (last = task?.status.name))
      return last === 'Done'
    }, 'GHI-1 done')

    expect(said.comment).toBe('GHI-1: comment added')
    expect((await store.comments({ project: FEED_ID, number: 1 })).map((each) => each.body)).toContain('Feed work done')
    expect(said.blocker).toBe('GHI-2 Feed blocker')
    const blocker = await store.get({ project: FEED_ID, number: 2 })
    expect(blocker?.title).toBe('Feed blocker')
    expect(await store.get({ project: PROJECT_ID, number: 2 })).toBeUndefined()
    expect(said.list.split('\n')).toEqual(expect.arrayContaining([expect.stringMatching(/^ABC-1 · .* · Main task$/), expect.stringMatching(/^GHI-1 · .* · Feed task$/), expect.stringMatching(/^GHI-2 · .* · Feed blocker$/)]))
    expect(said.cross).toMatch(/links don't cross trackers/)
    expect(await store.get({ project: FEED_ID, number: 3 })).toBeUndefined()
  })
})
