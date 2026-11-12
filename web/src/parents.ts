import { isOpen, runLabelOf, type ParentTask } from '../../src/tracker/model.js'
import type { EvenKeelState } from '../../src/state.js'
import { taskSession, type ChainBlock, type ChainStatus } from './state.js'
import { taskLamp } from './taskLamp.js'

/** The address parameter of the project page's feed view: `?view=parents` shows the parents instead of the chain (BTN-1041). */
export const VIEW_PARAM = 'view'
export const PARENTS_VIEW = 'parents'

type ParentsSource = Pick<EvenKeelState, 'parents' | 'sessions' | 'taskSessions' | 'chain'>

const byNumber = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

export function hasParents(state: Pick<EvenKeelState, 'parents'>, project: string): boolean {
  return (state.parents?.[project]?.length ?? 0) > 0
}

/** The address asks for the parents and the project has some; otherwise the feed is the chain. */
export function parentView(search: string, any: boolean): boolean {
  return any && new URLSearchParams(search).get(VIEW_PARAM) === PARENTS_VIEW
}

/** The address of the parents view, a parent's panel open when one is named. */
export function parentsTo(search: string, parent = ''): { search: string; hash: string } {
  const next = new URLSearchParams(search)
  next.set(VIEW_PARAM, PARENTS_VIEW)
  return { search: next.toString(), hash: parent }
}

/** The address of the chain view: the view parameter gone, the rest kept. */
export function chainTo(search: string): { search: string; hash: string } {
  const next = new URLSearchParams(search)
  next.delete(VIEW_PARAM)
  return { search: next.toString(), hash: '' }
}

/** The chain needs the user while another view is open: it is paused, or its current task waits for a reply. */
export function chainCalls(blocks: Pick<ChainBlock, 'current' | 'lamp'>[], status: ChainStatus): boolean {
  return status.kind === 'paused' || blocks.some((block) => block.current && block.lamp === 'waiting')
}

/**
 * The rows of the "Parents" view: the closed parents first, for the archive, then the open ones by the chain's milestones.
 * None is in the chain's order: no number, no drag, and its session panel only reads.
 */
export function parentBlocks(state: ParentsSource, project: string): ChainBlock[] {
  const parents = state.parents?.[project] ?? []
  const milestones = (state.chain.projects[project]?.milestones ?? []).map((each) => each.label)
  const rank = (task: ParentTask) => {
    if (task.milestone === null) return milestones.length + 1
    const at = milestones.indexOf(task.milestone.label)
    return at < 0 ? milestones.length : at
  }
  const closed = parents.filter((task) => !isOpen(task.status)).sort((a, b) => byNumber(a.id, b.id))
  const open = parents.filter((task) => isOpen(task.status)).sort((a, b) => rank(a) - rank(b) || byNumber(a.id, b.id))
  return [...closed, ...open].map((task) => {
    const session = taskSession(state.sessions, task.id) ?? null
    return {
      id: task.id,
      title: task.title,
      status: task.status.name,
      stage: task.status.category,
      lamp: taskLamp(task, session),
      open: false,
      locked: false,
      blockedBy: [],
      milestone: task.milestone?.label ?? null,
      after: [],
      current: false,
      skipped: false,
      question: task.question,
      priority: task.priority,
      estimate: task.estimate,
      parent: task.parent,
      labels: task.labels,
      runLabels: task.labels.filter((label) => runLabelOf(label) !== null),
      session,
      sessions: state.taskSessions[task.id] ?? [],
      limit: null,
      start: null,
      subtasks: { closed: task.closedSubtasks, total: task.subtasks },
    }
  })
}
