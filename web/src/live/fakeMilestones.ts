import { milestoneSequence } from '../../../src/chain/milestone-sequence.js'
import { activeMilestone, milestoneCandidate } from '../../../src/chain/milestones.js'
import { chainOrder, withFresh } from '../../../src/chain/order.js'
import type { EvenKeelState } from '../../../src/state.js'

/**
 * Each project's live milestones (BTN-792) as the service lists them: those of its chain, waiting and backlog tasks,
 * in its saved order. The fake does not reorder the chain by it.
 */
export function withLiveMilestones(state: EvenKeelState): EvenKeelState {
  const projects = Object.fromEntries(Object.entries(state.chain.projects).map(([project, order]) => {
    const ids = new Set([...order.order, ...order.waiting, ...order.backlog])
    const live = state.tasks.filter((task) => ids.has(task.id)).flatMap((task) => (task.milestone === null ? [] : [task.milestone]))
    return [project, { ...order, milestones: milestoneSequence(live, state.config.projects[project]?.milestoneOrder ?? []) }]
  }))
  return { ...state, chain: { ...state.chain, projects } }
}

/** `project/milestone-order`: the project's saved order, an empty one back to automatic. */
export function withSavedMilestoneOrder(state: EvenKeelState, body: Record<string, unknown>): EvenKeelState {
  const project = String(body.project)
  const form = state.config.projects[project]
  if (form === undefined) return state
  const { milestoneOrder: _, ...rest } = form
  const order = Array.isArray(body.order) ? body.order.map(String) : []
  const next = order.length === 0 ? rest : { ...rest, milestoneOrder: order }
  return withLiveMilestones({ ...state, config: { ...state.config, projects: { ...state.config.projects, [project]: next } } })
}

/** A bare backlog task whose preview lands among the active milestone's rows. */
export function withMilestonePreview(state: EvenKeelState, mode: string): EvenKeelState {
  const order = state.chain.projects.ABC!
  const current = state.chain.active.find((each) => each.project === 'ABC')?.current?.task
  const tasks = state.tasks.map((task) => task.id === 'ABC-20' ? {
    ...task,
    priority: 'medium' as const,
    ...(mode === 'blocked' && { blockedBy: ['ABC-14'] }),
    ...(mode === 'long' && { title: 'Show the complete keyboard shortcut reference for every action in the project page' }),
  } : task)
  const chain = order.order.map((id) => tasks.find((task) => task.id === id)!)
  const task = tasks.find((task) => task.id === 'ABC-20')!
  const donor = mode === 'off' ? undefined : activeMilestone(chain, current)
  const candidate = milestoneCandidate(task, donor, [...chain, task])
  const planned = [...chain, candidate]
  const placed = chainOrder(planned, withFresh(planned, order.order, [task.id], 1))
  return {
    ...state,
    tasks,
    chain: { ...state.chain, projects: { ...state.chain.projects, ABC: {
      ...order,
      landing: { ...order.landing, [task.id]: placed[placed.indexOf(task.id) + 1] ?? null },
      ...(candidate !== task && { landingMilestones: { [task.id]: candidate.milestone! } }),
    } } },
  }
}
