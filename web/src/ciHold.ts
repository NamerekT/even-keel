import type { ActiveChain, MainCiView } from '../../src/chain/model.js'
import type { CiView } from '../../src/ci/model.js'

/** What the chain waits for on main, as the CI panel says it (BTN-829). */
export type ChainHold = { kind: 'verdict' | 'after' | 'local'; commit: string; since: string } | { kind: 'late'; commit: string; until: string }

/**
 * The chain's wait on main, else the late watch of a push no runner took. The fix of another project's red main is
 * left to the chain's own line, which names that project.
 */
export function chainHoldOf(wait: ActiveChain['ciWait'], main: MainCiView | undefined): ChainHold | null {
  if (wait !== undefined && wait.by === undefined) {
    const kind = wait.after === true ? 'after' : wait.local === true ? 'local' : 'verdict'
    return { kind, commit: wait.commit, since: wait.since }
  }
  return main?.late === undefined ? null : { kind: 'late', ...main.late }
}

/**
 * The card the line goes into: the first counted CI whose push is at the commit, else one with the commit pushed and
 * not yet taken, else apart at the top of the first card, naming the commit.
 */
export function holdPlace(hold: ChainHold, views: CiView[]): { index: number; at: 'push' | 'pushed' | 'apart' } | null {
  const push = views.findIndex((view) => view.counted && view.current?.commit === hold.commit)
  if (push >= 0) return { index: push, at: 'push' }
  const pushed = views.findIndex((view) => view.counted && view.pushed?.commit === hold.commit)
  if (pushed >= 0) return { index: pushed, at: 'pushed' }
  return views.length === 0 ? null : { index: 0, at: 'apart' }
}
