import { describe, expect, it } from 'vitest'
import { chainMachines } from '../machine/chain-machines.js'
import { done, setup, task } from './dispatcher.fixture.js'

/** The hub's machines through the real `chainMachines`, the own `pc` and `server` elsewhere, with pins by task (BTN-1623). */
function pinnedMachines(pins: Record<string, string[]>, width = 1) {
  const online = new Set(['server'])
  const bound: Record<string, string> = {}
  const machines = chainMachines({
    own: () => 'pc',
    parallel: () => 1,
    peers: () => (online.has('server') ? [{ id: 'server', capacity: 1 }] : []),
    pool: () => ['pc', 'server'],
    width: () => width,
    machineOf: (_project, id) => bound[id],
    revoked: () => false,
    connected: (machine) => online.has(machine),
    agentOf: () => 'claude',
    agents: () => ['claude'],
    pinned: (_project, id) => pins[id],
    bind: (_project, id, machine) => {
      bound[id] = machine
    },
  })
  return { machines, online, bound }
}

const lanesOf = (run: ReturnType<typeof setup>) => run.dispatcher.state.active.map((chain) => [chain.machine, chain.current?.task ?? null])

describe('a task pinned to machines (BTN-1623)', () => {
  it('goes only to its machine; the lane elsewhere passes it over and takes the next one', async () => {
    const { machines, bound } = pinnedMachines({ 'ABC-1': ['server'] }, 2)
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-2'], ['server', 'ABC-1']])
    expect(bound).toEqual({ 'ABC-2': 'pc', 'ABC-1': 'server' })
  })

  it('is taken by its own machine as any task; with no pin each machine takes the next', async () => {
    const { machines } = pinnedMachines({ 'ABC-1': ['pc'] }, 2)
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-1'], ['server', 'ABC-2']])
  })

  it('waits while its machine is away, with what depends on it; the chain goes on and the machine takes it once back', async () => {
    const { machines, online } = pinnedMachines({ 'ABC-1': ['server'] })
    online.delete('server')
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', undefined, 'ABC-1'), task('ABC-3')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-3']])

    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', undefined, 'ABC-1'), task('ABC-3', done)])
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([])
    expect(run.dispatcher.state.queue).toEqual(['ABC'])
    expect(run.log).toContain('chain: ABC waits for a machine that may take its next task')
    expect(run.launched).toEqual(['ABC/ABC-3'])

    online.add('server')
    run.dispatcher.check()
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['server', 'ABC-1']])
  })

  it('stays with the machine holding it when the pin names another: only Reassign moves it', async () => {
    const pins: Record<string, string[]> = {}
    const { machines, bound } = pinnedMachines(pins, 2)
    bound['ABC-1'] = 'server'
    pins['ABC-1'] = ['pc']
    const run = setup({ machines })
    run.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await run.dispatcher.start('ABC')
    await run.dispatcher.idle()
    expect(lanesOf(run)).toEqual([['pc', 'ABC-2'], ['server', 'ABC-1']])
  })
})
