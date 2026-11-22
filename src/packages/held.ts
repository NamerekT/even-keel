import type { ProjectPackages, WaitedPackage } from '../state.js'

/**
 * The enabled packages of a set with the problems that hold its sessions. A problem of the set as a whole
 * (`noTrackerMcp`) and `unsupported` are left out: the first pauses the chain rather than holds it, the second holds
 * nothing. Free of `node:*`: the page reads it too.
 */
export function heldPackages(set: Pick<ProjectPackages, 'cells'> | undefined): WaitedPackage[] {
  return Object.entries(set?.cells ?? {}).flatMap(([name, cell]) => {
    const problems = cell.enabled ? cell.problems.filter((each) => each.kind !== 'unsupported') : []
    return problems.length === 0 ? [] : [{ name, problems }]
  })
}
