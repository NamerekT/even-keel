import type { EvenKeelState } from '../../../src/state.js'
import { readFresh } from '../../../src/tracker/health.js'

export type ProfileOffState = Pick<EvenKeelState, 'trackers' | 'config' | 'profiles'>

/** The project's readers: itself and each of its task feeds, as the service reads them (`readerIds`). */
const readersOf = (state: ProfileOffState, project: string): string[] => [project, ...(state.config.feeds[project] ?? []).map((feed) => feed.id)]

/** The turned-off profile one of the project's readers runs on (BTN-830); `null` — none is off. */
export function offProfile(state: ProfileOffState, project: string): { id: string; name: string } | null {
  for (const reader of readersOf(state, project)) {
    const view = state.trackers.find((each) => each.projects.includes(reader))
    if (view?.disabled !== true) continue
    const profile = state.profiles.profiles.find((each) => each.id === view.name)
    return { id: view.name, name: profile?.name ?? view.title }
  }
  return null
}

/**
 * A reader's tasks have not been read since its tracker last answered again, so Start waits: the service refuses a start
 * by that list (`chain.unread`). A tracker that is off has nothing to read and holds nothing.
 */
export function readingTasks(state: ProfileOffState, project: string): boolean {
  return readersOf(state, project).some((reader) => {
    const view = state.trackers.find((each) => each.projects.includes(reader))
    return view !== undefined && view.health.state !== 'off' && !readFresh(view, reader)
  })
}
