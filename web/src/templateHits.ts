import type { EvenKeelState } from '../../src/state.js'
import type { TemplateHit } from '../../src/tracker/templates.js'

/**
 * A label the project trusts as a person's go that an issue template puts on for any author (BTN-1130): a required
 * label of one of its sources, or its intake label.
 */
export interface TemplateLabel {
  /** The reader whose required label it is; `null` — the project's intake label. */
  reader: string | null
  /** The source's place as the page names it: `owner/name` where it has one, its key otherwise; `null` for the intake. */
  place: string | null
  feed: boolean
  label: string
  /** The templates' file names, in order. */
  templates: string[]
}

/** The reader's required labels a template puts on, by the tracker's last read, one entry a label. */
export const readerTemplateLabels = (state: EvenKeelState, reader: string): { label: string; templates: string[] }[] =>
  byLabel(state.trackers.find((tracker) => tracker.projects.includes(reader) && tracker.templateHits?.[reader] !== undefined)?.templateHits?.[reader] ?? [])

/** The project's own tracker first, then its feeds, then its intake label. */
export function templateLabels(state: EvenKeelState, project: string): TemplateLabel[] {
  const sources = [
    { reader: project, place: state.config.projects[project]?.trackerProject ?? state.projectKeys[project] ?? project, feed: false },
    ...(state.config.feeds[project] ?? []).map((feed) => ({ reader: feed.id, place: feed.place ?? feed.key, feed: true })),
  ]
  return [
    ...sources.flatMap((source) => readerTemplateLabels(state, source.reader).map((hit) => ({ ...source, ...hit }))),
    ...byLabel(state.intakeTemplates?.[project] ?? []).map((hit) => ({ reader: null, place: null, feed: false, ...hit })),
  ]
}

function byLabel(hits: readonly TemplateHit[]): { label: string; templates: string[] }[] {
  const labels = new Map<string, string[]>()
  for (const hit of hits) labels.set(hit.label, [...(labels.get(hit.label) ?? []), fileName(hit.template)])
  return [...labels].map(([label, templates]) => ({ label, templates }))
}

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
