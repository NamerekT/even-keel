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
})
