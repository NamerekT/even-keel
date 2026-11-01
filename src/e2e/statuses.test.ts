import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, Gate, parked } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'
import { BACKLOG, TODO } from './tracker.fixture.js'

describe('the statuses of the tracker', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const current = () => run.service.dispatcher.state.active.find((each) => each.project === PROJECT_ID)?.current?.task
  const refusals = () => run.service.getState().trackers.flatMap((view) => view.completionFailures?.[PROJECT_ID] ?? [])

  it('moves a task into the status set for its start and closes it into Done after the merge', async () => {
    run.project.statusMoves = { start: 'In Progress' }
    run.board.add('ABC-1')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge()))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'In Progress', 'ABC-1 moved on its start')
    expect(run.log).toContain('tracker: moved ABC-1 to "In Progress" on its start')
    gate.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.until(() => !existsSync(launches()[0]!.cwd), 'the worktree of ABC-1 removed')
  })

  it('holds a merged task the tracker refuses to close, tries again every 30 s and goes on once it closes', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.board.refuseComplete = 'Field "Resolution" is required'
    run.agent.script('ABC-1', commitAndMerge('ABC-1.txt'))
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => refusals().length > 0, 'the refusal shown')
    expect(refusals()).toEqual([expect.objectContaining({ code: 'tracker.completeRefused', params: expect.objectContaining({ task: 'ABC-1' }) })])
    const tries = run.board.completions
    await run.pass(90_000)
    expect(run.board.completions - tries).toBeGreaterThanOrEqual(2)
    expect(run.board.status('ABC-1')).toBe('Todo')
    expect(current()).toBe('ABC-1')
    expect(launches()).toHaveLength(1)

    run.board.refuseComplete = null
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.until(() => !existsSync(launches()[0]!.cwd), 'the worktree of ABC-1 removed')
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(refusals()).toEqual([])
  })

  it.each([1, 2])('closes a parent once the last of its %i subtasks is done', async (count) => {
    run.board.add('ABC-1')
    const children = Array.from({ length: count }, (_, index) => `ABC-${index + 2}`)
    for (const [index, child] of children.entries()) {
      run.board.child(child, 'ABC-1')
      if (index > 0) run.board.tasks.get(child)!.blockedBy = [children[index - 1]!]
      run.agent.script(child, commitAndMerge(`${child}.txt`))
    }
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'the parent done')
    expect(children.map((child) => run.board.status(child))).toEqual(children.map(() => 'Done'))
    expect(launches().map((call) => call.task)).toEqual(children)
    expect(run.log).toContain('Board: closed ABC-1, all its subtasks are closed')
  })

  it('takes a task from the backlog into the chain once it is moved to a ready status', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2')
    run.board.add('ABC-3')
    run.board.move('ABC-2', BACKLOG)
    run.board.move('ABC-3', BACKLOG)
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge('ABC-1.txt')))
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')

    run.board.move('ABC-2', TODO)
    await run.pass(60_000)
    gate.open()
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    await run.pass(60_000)
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2'])
    expect(run.board.status('ABC-3')).toBe('Backlog')
  })

  it('logs a tracker that fails on every read once, keeps the task and its session, and goes on once it answers', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge('ABC-1.txt')))
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')

    run.board.failReads = 'connect ECONNREFUSED 127.0.0.1:8080'
    await run.pass(3 * 60_000)
    // Once by each read: the poll of the held tasks' statuses and the project's full read.
    expect(run.log.filter((line) => line.includes('ECONNREFUSED'))).toEqual(['Board: connect ECONNREFUSED 127.0.0.1:8080', 'Board: ABC: connect ECONNREFUSED 127.0.0.1:8080'])
    expect(current()).toBe('ABC-1')
    expect(run.agent.calls.map((call) => call.kind)).toEqual(['launch'])

    run.board.failReads = null
    await run.until(() => run.log.some((line) => line.includes('reads again')), 'the read back')
    gate.open()
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2'])
  })
})
