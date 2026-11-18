import type { EvenKeelState } from '../../src/state.js'

/** The project's page: by its id, which outlives a change of the key. */
export function projectPath(project: string): string {
  return `/p/${encodeURIComponent(project)}`
}

/** The person's own projects: the demo's is none of theirs, so it neither ends the first run nor asks about the stats (BTN-776). */
export function ownProjects(state: Pick<EvenKeelState, 'projects' | 'demo'>): string[] {
  return state.projects.filter((id) => id !== state.demo?.project)
}

/**
 * The project a page address names: by its id, or by its key in a link from before ids (`byKey`, to be redirected) —
 * the first project of the key.
 */
export function projectOfPath(state: Pick<EvenKeelState, 'projects' | 'projectKeys'>, param: string): { project: string; byKey: boolean } {
  if (state.projects.includes(param)) return { project: param, byKey: false }
  const byKey = state.projects.find((project) => state.projectKeys[project] === param)
  return byKey === undefined ? { project: param, byKey: false } : { project: byKey, byKey: true }
}

/** What the page shows a project by (`projectLabel`): its key, with its name where another project has the key. */
export function projectLabel(state: Pick<EvenKeelState, 'projectLabels'> | null, project: string): string {
  return state?.projectLabels[project] ?? project
}

export function projectName(state: EvenKeelState, project: string): string | null {
  return state.config.projects[project]?.name ?? null
}

/** The tracker a project's card marks it with: its kind for the icon, the tracker with its profile and the tracker project for the tip. */
export function projectTracker(state: EvenKeelState, project: string): { kind: string; label: string } | null {
  const view = state.trackers.find((each) => each.projects.includes(project))
  if (view === undefined) return null
  const trackerProject = state.config.projects[project]?.trackerProject ?? null
  return { kind: view.kind, label: trackerProject === null ? view.title : `${view.title} · ${trackerProject}` }
}

/** A page of a project's tracker: `tracker` is the name a person reads, `kind` the tracker's (`null` — unknown). */
export interface TrackerPage {
  url: string
  tracker: string | null
  kind: string | null
}

/**
 * The pages where the project's new tasks are filed: its own in its tracker, then each feed's (BTN-329), with the tracker's
 * own name (`Huly`) for the button and its kind (`huly`) for the icon; two pages of one tracker add their keys to it.
 */
export function projectPages(state: EvenKeelState, project: string): TrackerPage[] {
  const titleOf = (kind: string | null) => state.config.trackers.find((each) => each.name === kind)?.title ?? null
  const ownKind = state.trackers.find((each) => each.projects.includes(project))?.kind ?? null
  const own = { id: project, key: state.projectKeys[project] ?? project, kind: ownKind, tracker: titleOf(ownKind) }
  const feeds = (state.config.feeds[project] ?? []).map((feed) => ({ id: feed.id, key: feed.key, kind: feed.tracker, tracker: titleOf(feed.tracker) }))
  const pages = [own, ...feeds].flatMap(({ id, ...page }) => {
    const url = state.trackerUrls.pages[id] ?? null
    return url === null ? [] : [{ url, ...page }]
  })
  return pages.map(({ url, key, kind, tracker }) => {
    const shared = pages.filter((other) => other.tracker === tracker).length > 1
    return { url, tracker: !shared ? tracker : tracker === null ? key : `${tracker} · ${key}`, kind }
  })
}

/** The palette slot of a project: its `color` setting (BTN-207); `null` — none, or not a project of the config. */
export function projectSlot(state: Pick<EvenKeelState, 'config'>, project: string): number | null {
  return state.config.projects[project]?.color ?? null
}

/** The slot of every project of the config by its id. */
export function projectSlots(state: Pick<EvenKeelState, 'config'>): Record<string, number | null> {
  return Object.fromEntries(Object.keys(state.config.projects).map((project) => [project, projectSlot(state, project)]))
}

/** The slots by project key, as Tally labels the projects; a key shared by several projects (BTN-271) takes the first one's in the config order. */
export function keySlots(state: Pick<EvenKeelState, 'config' | 'projectKeys'>): Record<string, number | null> {
  const slots: Record<string, number | null> = {}
  for (const project of Object.keys(state.config.projects)) {
    const key = state.projectKeys[project] ?? project
    if (!Object.hasOwn(slots, key)) slots[key] = projectSlot(state, project)
  }
  return slots
}
