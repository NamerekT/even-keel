import type { EvenKeelState } from '../../../src/state.js'
import { task } from './fakeSessions.js'

/** The v0.1 rows of ABC in three families that interleave: ABC-16 keeps 5 and 9, a new ABC-22 takes 6 and 8, ABC-17 takes 7. */
const PARENTS: Record<string, string> = { 'ABC-5': 'ABC-16', 'ABC-6': 'ABC-22', 'ABC-7': 'ABC-17', 'ABC-8': 'ABC-22', 'ABC-9': 'ABC-16' }

/**
 * Families across the frame "Under way" (BTN-1651), over `?chain=group&group=1` once ABC-5 is done above it and the
 * workstation runs ABC-6: the frame holds ABC-8 and ABC-6, ABC-7 and ABC-9 stand under it. `group` — ABC-16 runs from
 * ABC-5 above through ABC-8 to ABC-9 below, ABC-22 from ABC-6 out to ABC-7; `pass` — ABC-16 has only ABC-5 and ABC-9,
 * its rail dotted through the frame, and ABC-22 holds both rows in it.
 */
const GROUP_PARENTS: Record<string, Record<string, string>> = {
  group: { 'ABC-5': 'ABC-16', 'ABC-8': 'ABC-16', 'ABC-9': 'ABC-16', 'ABC-6': 'ABC-22', 'ABC-7': 'ABC-22' },
  pass: { 'ABC-5': 'ABC-16', 'ABC-9': 'ABC-16', 'ABC-8': 'ABC-22', 'ABC-6': 'ABC-22' },
}

/** `?families=3`: three rails side by side on the chain, for their lanes at both widths (BTN-1162). */
export function withFamilies(state: EvenKeelState): EvenKeelState {
  return withParents(state, PARENTS)
}

export function isGroupFamilies(kind: string | null): kind is 'group' | 'pass' {
  return kind === 'group' || kind === 'pass'
}

/** `?chain=group&group=1&families=group|pass`: see `GROUP_PARENTS`. */
export function withGroupFamilies(state: EvenKeelState, kind: 'group' | 'pass'): EvenKeelState {
  const project = state.chain.active[0]?.project
  const kept = project === undefined ? undefined : state.chain.projects[project]
  if (project === undefined || kept === undefined) return state
  const done = { name: 'Done', category: 'Won' as const }
  return withParents(
    {
      ...state,
      tasks: state.tasks.map((each) => (each.id === 'ABC-5' ? { ...each, status: done } : each)),
      sessions: state.sessions.map((view) => (view.task === 'ABC-5' ? { ...view, lamp: 'finished' as const } : view)),
      chain: {
        ...state.chain,
        active: state.chain.active.map((lane) => (lane.machine === 'pc' ? { ...lane, current: { task: 'ABC-6', sessionId: null, since: new Date().toISOString() } } : lane)),
        projects: { ...state.chain.projects, [project]: { ...kept, order: kept.order.filter((id) => id !== 'ABC-5') } },
      },
    },
    GROUP_PARENTS[kind]!,
  )
}

function withParents(state: EvenKeelState, parents: Record<string, string>): EvenKeelState {
  const parent = { ...task('ABC-22', 'Шапка и статусы', 'In Progress', 'Active', [], 'v0.1 — каркас', { subtasks: 2 }), closedSubtasks: 0 }
  return {
    ...state,
    tasks: state.tasks.map((each) => (parents[each.id] === undefined ? each : { ...each, parent: parents[each.id]! })),
    parents: { ...state.parents, ABC: [...(state.parents?.ABC ?? []), parent] },
  }
}
