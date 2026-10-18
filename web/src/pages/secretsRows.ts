import type { SecretView } from '../../../src/state.js'

export type SecretGroup = 'tally' | 'page'

/** The rows by their first reader: Tally and the page. */
export function secretGroups(variables: readonly SecretView[]): { group: SecretGroup; variables: SecretView[] }[] {
  const groups = new Map<SecretGroup, SecretView[]>()
  for (const variable of variables) {
    const group: SecretGroup = variable.readers.tally ? 'tally' : 'page'
    groups.set(group, [...(groups.get(group) ?? []), variable])
  }
  return [...groups].map(([group, each]) => ({ group, variables: each }))
}
