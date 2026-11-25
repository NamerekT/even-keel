import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BuiltinFiles } from '../builtin/files.js'
import { BuiltinStore } from '../builtin/store.js'
import { commitAndMerge, ends } from './agent.fixture.js'
import { FEED_ID, FEED_KEY, Harness, PROJECT_ID } from './service.fixture.js'
import { BOARD_TRACKER } from './tracker.fixture.js'
import { scaled } from '../../test/slow-runner.js'

describe('the built-in tracker end to end', { timeout: scaled(120_000) }, () => {
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

  it('the last task of a milestone, launched through a profile since removed, stays on the page under its milestone with its priority and labels (BTN-1588)', async () => {
    run.project.tracker = 'builtin'
    run.agent.script('ABC-1', commitAndMerge('ABC-1.txt'))
    await run.start()
    await run.post('builtin/milestone', { project: PROJECT_ID, name: 'v1', date: null })
    await run.post('builtin/create', { project: PROJECT_ID, title: 'Last of v1', milestone: 'v1', priority: 'high', labels: ['Bug'] })
    await run.startChain(PROJECT_ID)

    const shown = () => run.service.getState().tasks.find((task) => task.id === 'ABC-1')
    await run.until(() => run.service.archive.some((each) => each.task === 'ABC-1'), 'ABC-1 archived')
    // As after a move off another tracker: the launch names a profile gone, so the read no longer asks for the task by
    // its key, and the milestone has no open task left for the read to give its closed ones.
    for (const entry of run.service.launches) if (entry.task === 'ABC-1') entry.profile = 'a-profile-removed'
    await run.service.refreshProject(PROJECT_ID)
    expect(run.service.tasksByProject.get(PROJECT_ID)?.map((task) => task.id)).toEqual([])
    expect(await statusOf(1)).toBe('Done')
    expect(shown()?.status.category).toBe('Won')
    expect(shown()).toMatchObject({ milestone: { label: 'v1' }, priority: 'high', labels: ['Bug'] })
  })

  it('a session splits its task through the tasks server: the chain runs the blocker, then the subtask, then closes the parent (BTN-768)', async () => {
    run.project.tracker = 'builtin'
    let created = ''
    let read = ''
    run.agent.script('ABC-1', async ({ tool }) => {
      read = await tool('tasks', 'task_read', { key: 'ABC-1', comments: true })
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
    // The set brings the tasks server, so with `brief` on auto only the key is in the prompt (BTN-1680).
    const prompt = run.agent.calls.find((call) => call.task === 'ABC-1')!.prompt
    expect(prompt).not.toContain('Feature')
    expect(prompt).toContain('task_read("ABC-1", comments: true)')
    expect(read).toContain('ABC-1 Feature')
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

  it('copies the tasks to another tracker, switches the project there and runs them in the order saved before (BTN-1074)', async () => {
    run.project.tracker = 'builtin'
    for (const task of ['BRD-1', 'BRD-2']) run.agent.script(task, commitAndMerge(`${task}.txt`))
    await run.start()
    await run.post('builtin/create', { project: PROJECT_ID, title: 'First' })
    await run.post('builtin/create', { project: PROJECT_ID, title: 'Second' })
    await run.until(() => run.service.dispatcher.view(PROJECT_ID).tasks.length === 2, 'both tasks read')
    await run.post('chain/order', { project: PROJECT_ID, order: ['ABC-2', 'ABC-1'] })

    run.board.keys.set(PROJECT_ID, 'BRD')
    const profile = run.service.profiles.current().profiles.find((each) => each.kind === BOARD_TRACKER)!.id
    expect((await run.refused('builtin/export/start', { project: PROJECT_ID, profile, place: '', key: 'ABC' })).code).toBe('switch.samePrefix')
    expect((await run.refused('builtin/export/switch', { project: PROJECT_ID })).code).toBe('switch.noCopy')
    await run.post('builtin/export/start', { project: PROJECT_ID, profile, place: '', key: 'BRD' })
    let checked = false
    await run.until(() => {
      void run.service.db.query<{ checked: string | null }>('select checked from tracker_exports').then(({ rows }) => (checked = rows[0]?.checked != null))
      return checked
    }, 'the copy finished and checked (BTN-1291)')
    await run.post('builtin/export/switch', { project: PROJECT_ID })
    const { rows: reports } = await run.service.db.query<{ matched: boolean }>('select matched from tracker_transfers')
    expect(reports).toEqual([{ matched: true }])
    expect(run.service.configStore.current).toMatchObject({ trackers: { [PROJECT_ID]: BOARD_TRACKER }, keys: { [PROJECT_ID]: 'BRD' } })
    expect(run.service.dispatcher.state.orders[PROJECT_ID]).toEqual(['BRD-2', 'BRD-1'])

    await run.startChain(PROJECT_ID)
    await run.until(() => run.board.status('BRD-1') === 'Done', 'BRD-1 done')
    const launches = run.agent.calls.filter((call) => call.kind === 'launch').map((call) => call.task)
    expect(launches).toEqual(['BRD-2', 'BRD-1'])
    expect(run.board.status('BRD-2')).toBe('Done')
    expect((await statusOf(1)) === 'Done').toBe(false)
  })

  it('imports the tasks of the board, switches the project to the built-in tracker and runs them there (BTN-1405)', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.board.reply('ABC-1', 'Note from the board')
    for (const task of ['ABC-1', 'ABC-2']) run.agent.script(task, commitAndMerge(`${task}.txt`))
    await run.start()

    expect((await run.refused('builtin/import/switch', { project: PROJECT_ID })).code).toBe('import.notFinished')
    const plan = await run.answer<{ counts: { tasks: number; comments: number; blocks: number } }>('builtin/import/plan', { project: PROJECT_ID })
    expect(plan.counts).toMatchObject({ tasks: 2, comments: 1, blocks: 1 })
    await run.post('builtin/import/start', { project: PROJECT_ID, authors: [{ kind: 'user', name: 'John Doe', as: 'user' }] })
    let checked = false
    await run.until(() => {
      void run.service.db.query<{ checked: string | null }>('select checked from tracker_imports').then(({ rows }) => (checked = rows[0]?.checked != null))
      return checked
    }, 'the import finished and checked')
    expect(await run.answer('builtin/import/switch', { project: PROJECT_ID })).toEqual({ key: 'ABC', renamed: 0 })
    const { rows: reports } = await run.service.db.query<{ direction: string; matched: boolean }>('select direction, matched from tracker_transfers')
    expect(reports).toEqual([{ direction: 'import', matched: true }])
    expect(run.service.configStore.current).toMatchObject({ trackers: { [PROJECT_ID]: 'builtin' }, keys: { [PROJECT_ID]: 'ABC' } })
    const store = new BuiltinStore(run.service.db)
    expect((await store.comments({ project: PROJECT_ID, number: 1 })).map((each) => each.body)).toEqual(['Note from the board'])
    expect(run.board.status('ABC-1')).toBe('Todo')

    await run.startChain(PROJECT_ID)
    let last: string | undefined
    await run.until(() => {
      void statusOf(2).then((status) => (last = status))
      return last === 'Done'
    }, 'ABC-2 done on the built-in tracker')
    const launches = run.agent.calls.filter((call) => call.kind === 'launch').map((call) => call.task)
    expect(launches).toEqual(['ABC-1', 'ABC-2'])
    expect(await statusOf(1)).toBe('Done')
    expect(run.board.status('ABC-1')).toBe('Todo')
  })

  it('switches an import past a released task: it stays released, and its Done on the built-in tracker cleans up after it (BTN-1459)', async () => {
    const released = () => run.service.dispatcher.state.released[PROJECT_ID] ?? []
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ say: 'Half of it' }))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.agent.sessionsOf('ABC-1')[0]?.state === 'done', 'the turn of ABC-1 ended')
    await run.post('chain/stop', { project: PROJECT_ID })
    await run.until(() => released().includes('ABC-1'), 'ABC-1 released')

    await run.post('builtin/import/plan', { project: PROJECT_ID })
    await run.post('builtin/import/start', { project: PROJECT_ID, authors: [] })
    let checked = false
    await run.until(() => {
      void run.service.db.query<{ checked: string | null }>('select checked from tracker_imports').then(({ rows }) => (checked = rows[0]?.checked != null))
      return checked
    }, 'the import finished and checked')
    expect(await run.answer('builtin/import/switch', { project: PROJECT_ID })).toEqual({ key: 'ABC', renamed: 0 })
    expect(run.service.configStore.current.trackers[PROJECT_ID]).toBe('builtin')
    expect(released()).toEqual(['ABC-1'])
    expect(run.git('worktree', 'list').split('\n')).toHaveLength(2)

    const store = new BuiltinStore(run.service.db)
    const key = { project: PROJECT_ID, number: 1 }
    await store.edit(key, { field: 'status', from: (await store.get(key))!.status.name, to: 'Done' })
    await run.until(() => !released().includes('ABC-1'), 'ABC-1 cleaned up after on the built-in tracker')
    expect(run.git('worktree', 'list').split('\n')).toHaveLength(1)
    expect(run.board.status('ABC-1')).not.toBe('Done')
  })

  it("gives a session its task's attachment as a copy in its own folder, never the store's path (BTN-1538)", async () => {
    run.project.tracker = 'builtin'
    let copy: string | null = null
    run.agent.script('ABC-1', async (step) => {
      copy = await readFile(join(step.cwd, '.temp', 'task-files', 'ABC-1', 'shot.png'), 'utf8').catch(() => null)
      return commitAndMerge('ABC-1.txt')(step)
    })
    await run.start()
    await run.post('builtin/create', { project: PROJECT_ID, title: 'With a picture' })
    const file = await new BuiltinFiles(new BuiltinStore(run.service.db), run.service.attachmentsDir).add({ project: PROJECT_ID, number: 1 }, { name: 'shot.png', type: 'image/png', bytes: Buffer.from('picture') })
    await run.startChain(PROJECT_ID)
    await run.until(() => copy !== null, 'ABC-1 read its copy')

    const prompt = run.agent.calls.find((call) => call.kind === 'launch' && call.task === 'ABC-1')!.prompt
    expect(copy).toBe('picture')
    expect(prompt).toMatch(/shot\.png — .*[\\/]\.temp[\\/]task-files[\\/]ABC-1[\\/]shot\.png/)
    expect(prompt).not.toContain(join(run.service.attachmentsDir, file.sha256))
  })
})
