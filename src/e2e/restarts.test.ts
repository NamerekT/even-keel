import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, Gate, lingers, parked } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('the chain through a restart end to end', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const resumes = () => run.agent.calls.filter((call) => call.kind === 'resume')
  const stops = () => run.agent.calls.filter((call) => call.kind === 'stop').map((call) => call.sessionId)
  const lampOf = (sessionId: string) => run.service.sessions.find((view) => view.sessionId === sessionId)?.lamp

  it('closes a task merged while the service was down and goes on to the next one', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge('ABC-1.txt')))
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    const session = launches()[0]!

    await run.restart(async () => {
      gate.open()
      await gate.passed
      await run.agent.settled()
      expect(run.git('log', '--format=%s', 'main')).toContain('[ABC-1] Work')
      expect(run.board.status('ABC-1')).not.toBe('Done')
    })

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.until(() => !existsSync(session.cwd) && !run.git('branch', '--list', 'abc-1*').includes('abc-1'), 'the worktree and branch of ABC-1 removed')
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2'])
    expect(resumes()).toEqual([])
  })

  it('keeps its chain through a restart and leaves the working session alone', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge('ABC-1.txt')))
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')

    await run.restart()
    await run.pass(60_000)
    expect(run.agent.calls.map((call) => call.kind)).toEqual(['launch'])

    gate.open()
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2'])
    expect(resumes()).toEqual([])
  })

  it('stops the session of a task done before the first read of the sessions after a restart, then removes its folder', async () => {
    run.board.add('ABC-1')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge('ABC-1.txt')))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    const session = launches()[0]!

    const listing = new Gate()
    await run.restart(() => (run.agent.listing = listing))
    gate.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.pass(60_000)
    expect(existsSync(session.cwd)).toBe(true)

    run.agent.listing = null
    listing.open()
    await run.until(() => !existsSync(session.cwd), 'the worktree of ABC-1 removed')
    expect(run.agent.calls.filter((call) => call.kind === 'stop').map((call) => call.sessionId)).toEqual([session.sessionId])
    expect(run.service.dispatcher.state.leftovers).toEqual({})
  })

  it('stops the session of a task done right after a restart only once its turn ends, then removes its folder', async () => {
    run.board.add('ABC-1')
    const restarted = new Gate()
    const checked = new Gate()
    run.agent.script('ABC-1', parked(restarted, lingers(commitAndMerge('ABC-1.txt'), checked)))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    const session = launches()[0]!

    await run.restart()
    restarted.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.pass(60_000)
    expect(stops()).toEqual([])
    expect(existsSync(session.cwd)).toBe(true)

    checked.open()
    await run.until(() => !existsSync(session.cwd), 'the worktree of ABC-1 removed')
    expect(stops()).toEqual([session.sessionId])
    await run.until(() => lampOf(session.sessionId) === 'finished', 'the session of ABC-1 finished')
    expect(run.service.dispatcher.state.leftovers).toEqual({})
  })
})
