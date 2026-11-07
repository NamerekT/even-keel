import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { commitAndMerge } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

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
})
