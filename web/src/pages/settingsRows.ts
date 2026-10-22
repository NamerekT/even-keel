import { sameName } from '../../../src/chain/rules.js'
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
 * What the chain rules may name: what the tasks at hand carry and what the trackers name, a name once whatever its case
 * (the tasks' spelling first); the user may still type one they all lack.
 */
export function ruleChoicesOf(tasks: readonly Task[], vocabularies: readonly TrackerVocabulary[] = []): Required<TrackerVocabulary> {
  const sorted = (names: string[]) =>
    names.filter((name, index) => names.findIndex((each) => sameName(each, name)) === index).sort((a, b) => a.localeCompare(b))
  return {
    statuses: sorted([...tasks.map((task) => task.status.name), ...vocabularies.flatMap((each) => each.statuses)]),
    labels: sorted([...tasks.flatMap((task) => task.labels), ...vocabularies.flatMap((each) => each.labels)]),
    milestones: sorted([...tasks.flatMap((task) => (task.milestone === null ? [] : [task.milestone.label])), ...vocabularies.flatMap((each) => each.milestones ?? [])]),
  }
}

/** The choices less those the opposite list (a draft text, one per line) already has: the config refuses a name in both. */
export const withoutListed = (names: readonly string[], other: string): string[] =>
  names.filter((name) => !other.split('\n').some((line) => sameName(line, name)))
