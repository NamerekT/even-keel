import { describe, expect, it } from 'vitest'
import { chainMachines, type ChainMachineDeps } from './chain-machines.js'

function machinesOf(overrides: Partial<ChainMachineDeps> = {}) {
  const bound: string[] = []
  const machines = chainMachines({
    own: () => 'pc',
    parallel: () => 2,
    peers: () => [{ id: 'server', capacity: 3 }],
    pool: (project) => (project === 'p' ? ['pc', 'server'] : []),
    width: () => 1,
    machineOf: (_project, task) => ({ 'A-1': 'server', 'A-2': 'old' } as Record<string, string>)[task],
    revoked: (machine) => machine === 'old',
    agentOf: (_project, task) => (task.startsWith('C-') ? 'codex' : 'claude'),
    agents: (machine) => ({ pc: ['claude'], server: ['claude', 'codex'] } as Record<string, string[]>)[machine],
    bind: (project, task, machine) => void bound.push(`${project}/${task}@${machine}`),
    ...overrides,
  })
  return { machines, bound }
}

describe('chainMachines', () => {
  it('lists the own machine first with parallel places, then the machines elsewhere', () => {
    expect(machinesOf().machines.list()).toEqual([{ id: 'pc', capacity: 2 }, { id: 'server', capacity: 3 }])
  })

  it('serves a project by its pool; a project with no pool only on the own machine', () => {
    const { machines } = machinesOf()
    expect(machines.serves('p', 'server')).toBe(true)
    expect(machines.serves('q', 'pc')).toBe(true)
    expect(machines.serves('q', 'server')).toBe(false)
  })

  it('keeps a task with a revoked machine until a person moves it (BTN-1270)', () => {
    const { machines } = machinesOf()
    expect(machines.holder('p', 'A-1')).toBe('server')
    expect(machines.holder('p', 'A-2')).toBe('old')
    expect(machines.holder('p', 'A-3')).toBeUndefined()
    expect(machines.gone?.('old')).toBe(true)
    expect(machines.gone?.('server')).toBe(false)
  })

  it('never gives a moved task back to the machine it was moved off', () => {
    const { machines } = machinesOf({ movedFrom: (_project, task) => (task === 'A-7' ? 'server' : undefined) })
    expect(machines.runs('p', 'A-7', 'server')).toBe(false)
    expect(machines.runs('p', 'A-7', 'pc')).toBe(true)
    expect(machines.runs('p', 'A-8', 'server')).toBe(true)
  })

  it('gives a task only to a machine with its agent while another machine of the pool has one', () => {
    const { machines } = machinesOf()
    expect(machines.runs('p', 'C-1', 'pc')).toBe(false)
    expect(machines.runs('p', 'C-1', 'server')).toBe(true)
    expect(machines.runs('p', 'A-5', 'pc')).toBe(true)
  })

  it('lets a machine fall back to another agent when no machine of the pool has the task\'s', () => {
    const { machines } = machinesOf({ agents: () => ['claude'] })
    expect(machines.runs('p', 'C-1', 'pc')).toBe(true)
  })

  it('takes a width below one for one', () => {
    expect(machinesOf({ width: () => 0 }).machines.width('p')).toBe(1)
  })
})
