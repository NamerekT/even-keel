import type { EvenKeelState, TaskWork } from '../../src/state.js'

export type WorkInput = Pick<EvenKeelState, 'sessions' | 'tasks' | 'works'> & {
  chain: Pick<EvenKeelState['chain'], 'projects' | 'skipped' | 'leftovers'>
}

/**
 * The work in a task's folder that is in no commit of main (BTN-298), when it is the person's to deal with: the task is
 * in the backlog or out of the chain, skipped, or waits on its pull request with files left out of a commit. A task the
 * chain still leads or a session works on has its folder as its session's to change, and a closed one shows its work
 * only once the cleanup said what it left (BTN-332). The one rule of the chain row, the task card and the toasts (BTN-365).
 */
export function shownWork(state: WorkInput, project: string, task: string): TaskWork | null {
  const work = state.works[project]?.[task]
  if (work === undefined || state.sessions.some((session) => session.task === task && session.lamp === 'working')) return null
  const category = state.tasks.find((each) => each.id === task)?.status.category
  if (category === 'Won' || category === 'Lost') return (state.chain.leftovers[project] ?? []).some((each) => each.task === task) ? work : null
  const order = state.chain.projects[project]
  if ((state.chain.skipped[project] ?? []).includes(task)) return work
  if ((order?.reviews ?? []).some((review) => review.task === task)) return work.files > 0 ? work : null
  if (order === undefined || order.error !== null || order.order.includes(task) || order.waiting.includes(task)) return null
  return work
}
