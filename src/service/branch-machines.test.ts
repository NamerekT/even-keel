import { describe, expect, it } from 'vitest'
import type { MachineFacts } from '../machine/facts.js'
import type { RemoteMachine } from '../machine/remote.js'
import type { BranchShift } from '../projects/branch.js'
import { branchMachines, type BranchMachinesDeps } from './branch-machines.js'

const SHIFT: BranchShift = { before: { current: 'main', head: 'abc', branches: ['main'] }, move: { kind: 'switch', from: 'main' } }

function networkOf(online: string[]) {
  const calls: string[] = []
  const checkouts: Record<string, MachineFacts['checkouts']> = {
    server: { p: { branch: 'dev' }, q: { branch: 'main' } },
    laptop: { p: { branch: null } },
  }
  const remote = (machine: string) =>
    ({
      facts: () => ({ checkouts: checkouts[machine] }) as MachineFacts,
      services: () => ({
        branch: {
          move: async (project: string, branch: string) => (calls.push(`move ${machine} ${project} ${branch}`), SHIFT),
          back: async (project: string, branch: string) => void calls.push(`back ${machine} ${project} ${branch}`),
        },
      }),
    }) as unknown as RemoteMachine
  const network: BranchMachinesDeps['network'] = {
    poolOf: (project) => (project === 'p' ? ['pc', 'server', 'laptop'] : []),
    names: () => ({ pc: 'PC', server: 'Server', laptop: 'Laptop' }),
    connected: (machine) => online.includes(machine),
    remote: (machine) => (machine === 'pc' ? undefined : remote(machine)),
    live: () => ['pc', 'server', 'laptop'],
  }
  return { machines: branchMachines({ network, own: () => 'pc' }), calls }
}

describe('branchMachines (BTN-1567)', () => {
  it('lists the pool without the own machine, with names and who is online', () => {
    const { machines } = networkOf(['pc', 'server'])
    expect(machines.pool('p')).toEqual([
      { id: 'server', name: 'Server', online: true },
      { id: 'laptop', name: 'Laptop', online: false },
    ])
  })

  it('sends the move and the way back to the machine', async () => {
    const { machines, calls } = networkOf(['server'])
    expect(await machines.move('server', 'p', 'dev')).toBe(SHIFT)
    await machines.back('server', 'p', 'dev', SHIFT)
    expect(calls).toEqual(['move server p dev', 'back server p dev'])
  })

  it('refuses a command to a machine off the link', async () => {
    const { machines } = networkOf([])
    await expect(machines.move('laptop', 'p', 'dev')).rejects.toMatchObject({ notice: { code: 'machines.offline' } })
  })

  it('tells each pool machine\'s checkout, never a project the machine is not in the pool of', () => {
    expect(networkOf([]).machines.checkouts()).toEqual({ p: { server: 'dev', laptop: null } })
  })
})
