import { describe, expect, it } from 'vitest'
import { fakeMachines, setup, task } from './dispatcher.fixture.js'

const RESET = '2026-09-26T15:00:00.000Z'

/** Two machines of one place each, the pc's limit spent and the server's left; the chain of ABC started. */
async function started(options: { switchOnLimit: boolean; width?: number; serverCapacity?: number; serverHasLimit?: boolean; launchedBefore?: string }) {
  const fake = fakeMachines(
    { pc: 1, server: options.serverCapacity ?? 1 },
    {
      width: { ABC: options.width ?? 1 },
      switchOnLimit: options.switchOnLimit,
      hasLimit: (_project, _task, machine) => machine === 'server' && options.serverHasLimit !== false,
    },
  )
  const run = setup({ machines: fake.machines, limitResetOf: (_project, id) => (fake.bound[id] === 'pc' ? RESET : null) })
  if (options.launchedBefore !== undefined) {
    run.journal.push({ at: '2026-09-26T10:00:00.000Z', project: 'ABC', task: options.launchedBefore, sessionId: 'session-old', reason: 'start' })
  }
  run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await run.dispatcher.start('ABC')
  await run.dispatcher.idle()
  return { run, ...fake }
}

const lanesOf = (run: ReturnType<typeof setup>) =>
  run.dispatcher.state.active.map((chain) => [chain.machine, chain.current?.task ?? null, chain.limitUntil ?? null])

describe('The next task past a spent limit (BTN-996)', () => {
  it('with the switch off waits on the machine for its reset, and gives the project to no other machine', async () => {
    const { run, bound, limitMoves } = await started({ switchOnLimit: false })
    expect(run.launched).toEqual([])
    expect(lanesOf(run)).toEqual([['pc', null, RESET]])
    expect(bound).toEqual({ 'ABC-1': 'pc' })
    expect(limitMoves).toEqual([])
  })

  it('with the switch on gives the task to the machine with limit left, and tells the page', async () => {
    const { run, bound, limitMoves } = await started({ switchOnLimit: true })
    expect(run.launched).toEqual(['ABC/ABC-1'])
    expect(lanesOf(run)).toEqual([['server', 'ABC-1', null]])
    expect(bound).toEqual({ 'ABC-1': 'server' })
    expect(limitMoves).toEqual(['ABC-1: pc → server'])
    expect(run.log.some((line) => line.includes('ABC-1') && line.includes('pc') && line.includes('server') && line.includes('limit'))).toBe(true)
  })

  it('leaves a task launched before with its machine', async () => {
    const { run, bound, limitMoves } = await started({ switchOnLimit: true, launchedBefore: 'ABC-1' })
    expect(run.launched).toEqual([])
    expect(lanesOf(run)).toEqual([['pc', null, RESET]])
    expect(bound['ABC-1']).toBe('pc')
    expect(limitMoves).toEqual([])
  })

  it('waits when no other machine has limit left', async () => {
    const { run, limitMoves } = await started({ switchOnLimit: true, serverHasLimit: false })
    expect(run.launched).toEqual([])
    expect(lanesOf(run)).toEqual([['pc', null, RESET]])
    expect(limitMoves).toEqual([])
  })

  it('waits when the machine with limit left has no free place', async () => {
    const { run, limitMoves } = await started({ switchOnLimit: true, serverCapacity: 0 })
    expect(run.launched).toEqual([])
    expect(lanesOf(run)).toEqual([['pc', null, RESET]])
    expect(limitMoves).toEqual([])
  })

  it('moves no lane onto a machine that runs another lane of the project, whatever its free places (BTN-1569)', async () => {
    const { run, limitMoves } = await started({ switchOnLimit: true, width: 2, serverCapacity: 2 })
    expect(lanesOf(run)).toEqual([['pc', null, RESET], ['server', 'ABC-2', null]])
    expect(limitMoves).toEqual([])
  })

  it('leaves the lanes of a wider project to the plain pull: the other machine takes the next task beside the waiting one', async () => {
    const { run, limitMoves } = await started({ switchOnLimit: false, width: 2 })
    expect(run.launched).toEqual(['ABC/ABC-2'])
    expect(lanesOf(run)).toEqual([['pc', null, RESET], ['server', 'ABC-2', null]])
    expect(limitMoves).toEqual([])
  })
})
