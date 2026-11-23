import { fail } from '../notice/notice.js'
import type { BranchMachines } from '../projects/branch-control.js'
import type { MachineNetwork } from './machine-network.js'

export interface BranchMachinesDeps {
  network: Pick<MachineNetwork, 'poolOf' | 'names' | 'connected' | 'remote' | 'live'>
  /** The own machine's id: its folder is the hub's checkout, moved by `BranchControl` itself. */
  own(): string
}

/** The hub's side of the branch change on the machines elsewhere of each pool (BTN-1567): their mirrors and commands. */
export function branchMachines(deps: BranchMachinesDeps): BranchMachines {
  const { network } = deps
  const nameOf = (machine: string): string => network.names()[machine] ?? machine
  const online = (machine: string): boolean => network.connected(machine) && network.remote(machine) !== undefined
  const commands = (machine: string) => {
    const remote = network.remote(machine)
    if (remote === undefined || !network.connected(machine)) throw fail('machines.offline', { name: nameOf(machine) })
    return remote.services().branch
  }
  return {
    pool: (project) =>
      network.poolOf(project).filter((id) => id !== deps.own()).map((id) => ({ id, name: nameOf(id), online: online(id) })),
    move: async (machine, project, branch) => commands(machine).move(project, branch),
    back: async (machine, project, branch, shift) => commands(machine).back(project, branch, shift),
    checkouts: () => {
      const found: Record<string, Record<string, string | null>> = {}
      for (const machine of network.live()) {
        if (machine === deps.own()) continue
        for (const [project, { branch }] of Object.entries(network.remote(machine)?.facts()?.checkouts ?? {}))
          if (network.poolOf(project).includes(machine)) (found[project] ??= {})[machine] = branch
      }
      return found
    },
  }
}
