import type { CiKind, CiView } from '../../../src/ci/model.js'
import type { Notice } from '../../../src/notice/notice.js'
import type { SecretView } from '../../../src/state.js'
import type { TrackerView } from '../../../src/tracker/health.js'

export type SecretGroup = { kind: 'tracker'; tracker: string } | { kind: 'ci' | 'tally' | 'page' }

/** The rows by their first reader: each tracker in the catalog's order, then the CI, Tally and the page. */
export function secretGroups(variables: readonly SecretView[]): { group: SecretGroup; variables: SecretView[] }[] {
  const groups = new Map<string, { group: SecretGroup; variables: SecretView[] }>()
  for (const variable of variables) {
    const { readers } = variable
    const group: SecretGroup =
      readers.trackers.length > 0
        ? { kind: 'tracker', tracker: readers.trackers[0]! }
        : { kind: readers.ci.length > 0 ? 'ci' : readers.tally ? 'tally' : 'page' }
    const key = group.kind === 'tracker' ? `tracker:${group.tracker}` : group.kind
    const entry = groups.get(key) ?? { group, variables: [] }
    entry.variables.push(variable)
    groups.set(key, entry)
  }
  return [...groups.values()]
}

export type ReaderState = 'live' | 'down' | 'connecting' | 'off'

export interface ReaderLink {
  /** The tracker's title, or the CI by its kind. */
  who: { tracker: string } | { ci: CiKind }
  state: ReaderState
  /** Why it does not answer: the tracker's own text or the CI's notice. */
  error: string | Notice | null
}

/** Whether each tracker and CI that reads the variable answers with what the environment has now. */
export function readerLinks(variable: SecretView, trackers: readonly TrackerView[], ci: Readonly<Record<string, CiView[]>>): ReaderLink[] {
  const tracked = variable.readers.trackers.flatMap((name): ReaderLink[] => {
    const view = trackers.find((each) => each.name === name)
    return view === undefined ? [] : [{ who: { tracker: view.title }, state: view.health.state, error: view.health.error }]
  })
  const watched = variable.readers.ci.flatMap((kind): ReaderLink[] => {
    const views = Object.values(ci)
      .flat()
      .filter((view) => view.kind === kind)
    if (views.length === 0) return []
    const failed = views.find((view) => view.health === 'error')
    if (failed !== undefined) return [{ who: { ci: kind }, state: 'down', error: failed.error }]
    if (views.every((view) => view.health === 'off')) return [{ who: { ci: kind }, state: 'off', error: null }]
    return [{ who: { ci: kind }, state: views.some((view) => view.health === 'ok' && view.checkedAt === null) ? 'connecting' : 'live', error: null }]
  })
  return [...tracked, ...watched]
}
