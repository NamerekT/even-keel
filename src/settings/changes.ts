/** A change of one row: what a save of the page, or a button, writes. An unset of a qualified key without a qualifier takes all its entries. */
export type RowChange =
  | { op: 'set'; key: string; project: string | null; qualifier: string; value: unknown }
  | { op: 'unset'; key: string; project: string | null; qualifier: string }

/** One value a form shows, as the row it would be. */
export interface FormValue {
  /** The part of the form it changes with: every value of a changed group is written, the others stay as they are. */
  group: string
  key: string
  qualifier: string
  /** `undefined` — no row: the level inherits. */
  value: unknown
  /** What having no row gives: a value equal to it is not written either. */
  fallback?: unknown
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The rows the changed groups of a form set or unset at the level. Sets go first, so an object of the file that loses
 * one entry and gains another keeps its place.
 */
export function changesOf(project: string | null, values: FormValue[], changed: (group: string) => boolean): RowChange[] {
  const changes = values.flatMap(({ group, key, qualifier, value, fallback }): RowChange[] => {
    if (!changed(group)) return []
    if (value === undefined || same(value, fallback)) return [{ op: 'unset', key, project, qualifier }]
    return [{ op: 'set', key, project, qualifier, value }]
  })
  return [...changes.filter((change) => change.op === 'set'), ...changes.filter((change) => change.op === 'unset')]
}
