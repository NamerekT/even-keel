import { sameName } from '../../../src/chain/rules.js'
import type { FeedView } from '../../../src/state.js'
import type { Task } from '../../../src/tracker/model.js'
import type { TrackerVocabulary } from '../../../src/tracker/source.js'

const ARROW = '=>'

/** The rows of a list field kept as lines: an empty row stays while it is typed, the save drops it. */
export const rowsOf = (text: string): string[] => (text === '' ? [] : text.split('\n'))
export const linesText = (rows: readonly string[]): string => rows.join('\n')

/** A moved folder as the config writes it: `old => new`. */
export function pairOf(line: string): [string, string] {
  const at = line.indexOf(ARROW)
  return at < 0 ? [line.trim(), ''] : [line.slice(0, at).trim(), line.slice(at + ARROW.length).trim()]
}
export const lineOf = ([from, to]: readonly string[]): string => `${from} ${ARROW} ${to}`

/**
 * The labels and milestones the rules may name: what the tasks at hand carry and what the trackers name, a name once
 * whatever its case (the tasks' spelling first); the user may still type one they all lack. The statuses are `knownStatuses`.
 */
export function ruleChoicesOf(tasks: readonly Task[], vocabularies: readonly TrackerVocabulary[] = []): Required<Omit<TrackerVocabulary, 'statuses'>> {
  const sorted = (names: string[]) =>
    names.filter((name, index) => names.findIndex((each) => sameName(each, name)) === index).sort((a, b) => a.localeCompare(b))
  return {
    labels: sorted([...tasks.flatMap((task) => task.labels), ...vocabularies.flatMap((each) => each.labels)]),
    milestones: sorted([...tasks.flatMap((task) => (task.milestone === null ? [] : [task.milestone.label])), ...vocabularies.flatMap((each) => each.milestones ?? [])]),
  }
}

/**
 * The tasks of one source of the project (BTN-553): of a feed those whose id has its prefix (`readerOf` of the service),
 * of the main tracker (`null`) those no feed claims.
 */
export function sourceTasks(tasks: readonly Task[], feeds: readonly Pick<FeedView, 'id' | 'key' | 'prefix'>[], feed: string | null): Task[] {
  return tasks.filter((task) => (taskFeed(feeds, task.id)?.id ?? null) === feed)
}

/** The feed a task id is of by its prefix; none — the main tracker's. */
export const taskFeed = <T extends Pick<FeedView, 'id' | 'key' | 'prefix'>>(feeds: readonly T[], task: string): T | undefined =>
  feeds.find((each) => (each.prefix ?? each.key) === task.slice(0, task.lastIndexOf('-')))

/** The choices less those the opposite list (a draft text, one per line) already has: the config refuses a name in both. */
export const withoutListed = (names: readonly string[], other: string): string[] =>
  names.filter((name) => !other.split('\n').some((line) => sameName(line, name)))
