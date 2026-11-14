import type { EvenKeelState } from '../../src/state.js'

/** A source of the project's tasks whose repository anyone may open a task in, while it takes tasks without a label (BTN-1134). */
export interface OpenSource {
  /** The reader: the project itself, or one of its feeds. */
  reader: string
  /** Its place in the tracker as the page names it: `owner/name` where it has one, its key otherwise. */
  place: string
  feed: boolean
}

/** Whether the tracker's last read found this reader open to anyone. */
export const isOpenToAll = (state: EvenKeelState, reader: string): boolean =>
  state.trackers.some((tracker) => tracker.projects.includes(reader) && tracker.openToAll?.[reader] === true)

/** The project's sources, its own tracker first and then its feeds, that the last read found open to anyone. */
export function openToAllSources(state: EvenKeelState, project: string): OpenSource[] {
  const sources: OpenSource[] = [
    { reader: project, place: state.config.projects[project]?.trackerProject ?? state.projectKeys[project] ?? project, feed: false },
    ...(state.config.feeds[project] ?? []).map((feed) => ({ reader: feed.id, place: feed.place ?? feed.key, feed: true })),
  ]
  return sources.filter(({ reader }) => isOpenToAll(state, reader))
}
