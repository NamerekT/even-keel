import type { PackagesView } from '../../../src/state.js'

export type Skill = PackagesView['skills']['list'][number]

/** The order fixed at the open: the ticked skills first, so a tick or an untick never moves a row under the pointer. */
export function skillOrder(list: Skill[], picked: Set<string>): string[] {
  return [...list].sort((a, b) => Number(picked.has(b.name)) - Number(picked.has(a.name))).map((each) => each.name)
}

/**
 * The rows to show: in the order of the open, a skill that appeared since at the end, one that is gone left out; `only` —
 * the filter of the ticked ones as they were when it was pressed; `query` — a part of the name, in any case.
 */
export function shownSkills(first: string[], list: Skill[], only: Set<string> | null, query: string): Skill[] {
  const byName = new Map(list.map((each) => [each.name, each]))
  const known = new Set(first)
  const order = [...first, ...list.map((each) => each.name).filter((name) => !known.has(name))]
  const words = query.trim().toLowerCase()
  return order
    .map((name) => byName.get(name))
    .filter((each): each is Skill => each !== undefined && (only === null || only.has(each.name)) && each.name.toLowerCase().includes(words))
}
