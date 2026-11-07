import { ownsMilestone, type ChainRules } from '../../../src/chain/rules.js'
import type { Section } from './milestones.js'

/** The built-in tracker's add ghosts (BTN-770): where they stand and what the task they make gets. */

export type MilestoneRules = Pick<ChainRules, 'requiredMilestones' | 'excludedMilestones'>

/** What a task made by a ghost gets: in the chain Todo with its group's milestone, in the backlog Backlog without one. */
export interface AddPlace {
  status: 'Todo' | 'Backlog'
  milestone: string | null
}

export const chainPlace = (milestone: string | null): AddPlace => ({ status: 'Todo', milestone })

export const BACKLOG_PLACE: AddPlace = { status: 'Backlog', milestone: null }

/** The key a ghost's unsent title is kept under until the page reloads. */
export const draftKey = (project: string, place: AddPlace): string => `${project}:${place.status}:${place.milestone?.toLocaleLowerCase() ?? ''}`

const owns = (rules: MilestoneRules, milestone: string | null) =>
  ownsMilestone(rules, { milestone: milestone === null ? null : { label: milestone, targetDate: null } })

/** The project's milestones that no task of it carries, in their order: each is an empty group of the chain. */
export function emptyMilestones(milestones: readonly string[], used: readonly (string | null)[]): string[] {
  const taken = new Set(used.flatMap((name) => (name === null ? [] : [name.toLocaleLowerCase()])))
  return milestones.filter((name) => !taken.has(name.toLocaleLowerCase()))
}

/**
 * A section ends with a ghost when it holds an open task or no task at all, and the project's "Project tasks" take its
 * milestone; the last closed task of a finished milestone, still shown in the chain, gets none.
 */
export function takesGhost(section: Section<{ open: boolean; locked: boolean }>, rules: MilestoneRules): boolean {
  if (section.blocks.length > 0 && !section.blocks.some((block) => block.open || block.locked)) return false
  return owns(rules, section.milestone)
}

/** No shown section takes a ghost — an empty project, or one of closed tasks only: one ghost making a task without a milestone. */
export function looseGhost(sections: Section<{ open: boolean; locked: boolean }>[], rules: MilestoneRules): boolean {
  return !sections.some((section) => takesGhost(section, rules)) && owns(rules, null)
}
