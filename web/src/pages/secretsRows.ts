import type { CiKind, CiView } from '../../../src/ci/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { SecretView } from '../../../src/state.js'

export type SecretGroup = 'ci' | 'tally' | 'page'

/** The rows by their first reader: the CI, Tally and the page. */
export function secretGroups(variables: readonly SecretView[]): { group: SecretGroup; variables: SecretView[] }[] {
  const groups = new Map<SecretGroup, SecretView[]>()
  for (const variable of variables) {
    const { readers } = variable
    const group: SecretGroup = readers.ci.length > 0 ? 'ci' : readers.tally ? 'tally' : 'page'
    groups.set(group, [...(groups.get(group) ?? []), variable])
  }
  return [...groups].map(([group, each]) => ({ group, variables: each }))
}

export type ReaderState = 'live' | 'down' | 'connecting' | 'off'

export interface ReaderLink {
  who: { ci: CiKind }
  state: ReaderState
  /** Why it does not answer: the CI's notice. */
  error: Notice | null
}

/** Whether each CI that reads the variable answers with what the environment has now. */
export function readerLinks(variable: SecretView, ci: Readonly<Record<string, CiView[]>>): ReaderLink[] {
  return variable.readers.ci.flatMap((kind): ReaderLink[] => {
    const views = Object.values(ci)
      .flat()
      .filter((view) => view.kind === kind)
    if (views.length === 0) return []
    const failed = views.find((view) => view.health === 'error')
    if (failed !== undefined) return [{ who: { ci: kind }, state: 'down', error: failed.error }]
    if (views.every((view) => view.health === 'off')) return [{ who: { ci: kind }, state: 'off', error: null }]
    return [{ who: { ci: kind }, state: views.some((view) => view.health === 'ok' && view.checkedAt === null) ? 'connecting' : 'live', error: null }]
  })
}
