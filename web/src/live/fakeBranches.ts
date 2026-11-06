import { fail } from '../../../src/notice/notice.js'
import type { BranchChoice, BranchDrift, EvenKeelState, RepoBranches } from '../../../src/state.js'

/** The fake checkouts' other branches: `release/v1` lives only on `origin`; the task branches are hidden (BTN-765). */
const OTHERS: BranchChoice[] = [
  { name: 'develop', remote: null },
  { name: 'feature/spike', remote: null },
  { name: 'abc-12/task', remote: null, hidden: true },
  { name: 'release/v1', remote: 'origin' },
  { name: 'abc-7/task', remote: 'origin', hidden: true },
]

/** `?branch=drift` — ABC's checkout was switched by hand to `feature/spike` (BTN-754). */
export function fakeBranchDrift(mode: string | null): Record<string, BranchDrift> {
  return mode === 'drift' || mode === 'busy' ? { ABC: { branch: 'main', current: 'feature/spike' } } : {}
}

/** The branches of a fake project's checkout: it stands on its drift's branch, else on the project's. */
export function fakeRepoBranches(state: EvenKeelState, project: string): RepoBranches {
  const drift = state.branchDrift[project]
  const current = drift === undefined ? (state.config.projects[project]?.branch ?? 'main') : drift.current
  const local = [current, state.config.projects[project]?.branch ?? 'main'].filter((name): name is string => name !== null)
  const names = [...new Set(local)].map((name) => ({ name, remote: null }))
  return { current, head: 'a1b2c3d', branches: [...names, ...OTHERS.filter((each) => !local.includes(each.name))] }
}

/** The drift's buttons; `?branch=busy` refuses them as a project with a task in work does. */
export function fakeBranchCommand(state: EvenKeelState, name: string, body: Record<string, unknown>, mode: string | null): EvenKeelState | null {
  if (name !== 'project/branch/adopt' && name !== 'project/branch/restore') return null
  const project = String(body.project)
  if (mode === 'busy') throw fail('branch.busy', { project })
  const drift = state.branchDrift[project]
  const { [project]: _gone, ...branchDrift } = state.branchDrift
  if (drift === undefined || name === 'project/branch/restore' || drift.current === null) return { ...state, branchDrift }
  const form = state.config.projects[project]
  const projects = form === undefined ? state.config.projects : { ...state.config.projects, [project]: { ...form, branch: drift.current } }
  return { ...state, branchDrift, config: { ...state.config, projects } }
}
