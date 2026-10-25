import { activeMilestone, milestoneCandidate } from '../../../src/chain/milestones.js'
import { chainOrder, withFresh } from '../../../src/chain/order.js'
import type { EvenKeelState } from '../../../src/state.js'

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
