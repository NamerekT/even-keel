/**
 * A task's change history (BTN-1112): only the tracker kept in Even Keel itself writes it. Types only and pure helpers,
 * no `node:*`: the page takes them too.
 */

/** Who made a change: the person on the page, a session through the tasks server, or Even Keel itself. */
export type ChangeBy = 'person' | 'agent' | 'service'

export interface ChangeAuthor {
  by: ChangeBy
  /** Original author of an imported change; absent for local changes. */
  name?: string
  /** `<Provider> | <model>` of an agent's session; `null` — not an agent, or not known. */
  model: string | null
}

/**
 * What changed. `created` — the task was made; `moved` — it came over from another tracker, `to` its key there. A label,
 * a link and a subtask go one a change: `to` — added, `from` — removed. `run` holds JSON of the task's run.
 */
export type ChangeField =
  | 'created' | 'moved'
  | 'title' | 'status' | 'priority' | 'milestone' | 'component' | 'parent' | 'description' | 'estimate' | 'run'
  | 'label' | 'blocks' | 'blockedBy' | 'relates' | 'subtask'

export const CHANGE_FIELDS: readonly ChangeField[] = [
  'created', 'moved', 'title', 'status', 'priority', 'milestone', 'component', 'parent', 'description', 'estimate', 'run',
  'label', 'blocks', 'blockedBy', 'relates', 'subtask',
]

/** A line of a description's difference; an unchanged stretch far from any change is only counted. */
export type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string } | { kind: 'skipped'; lines: number }

export interface TaskChange {
  /** ms */
  at: number
  by: ChangeBy
  name?: string
  model: string | null
  field: ChangeField
  /** As text: a status, label or milestone by name, a task by its key, an estimate in minutes; `null` — none. */
  from: string | null
  to: string | null
  /** The description's change; the description itself is never kept twice. */
  diff?: DiffLine[]
}

/** Consecutive changes of one author within this long of the first make one journal entry. */
export const CHANGE_GLUE_MS = 5 * 60_000

/** Changes of one author close in time, as one journal entry shows them. */
export interface ChangeGroup {
  at: number
  by: ChangeBy
  name?: string
  model: string | null
  changes: TaskChange[]
}

/**
 * Glues consecutive changes of one author within `CHANGE_GLUE_MS` of the group's first into one entry. Inside it a field
 * changed twice is one row from the first value to the last, dropped when it came back; a label or a link added and
 * removed again is dropped; descriptions stay a row each, every one with its own difference. `breaks` — when the
 * comments were written, ms: a change after a comment never joins the changes before it.
 */
export function groupChanges(changes: readonly TaskChange[], breaks: readonly number[] = []): ChangeGroup[] {
  const groups: ChangeGroup[] = []
  for (const change of [...changes].sort((a, b) => a.at - b.at)) {
    const last = groups.at(-1)
    const lastAt = last?.changes.at(-1)?.at ?? 0
    const broken = breaks.some((at) => at > lastAt && at <= change.at)
    if (last !== undefined && !broken && last.by === change.by && last.name === change.name && last.model === change.model && change.at - last.at <= CHANGE_GLUE_MS) last.changes.push(change)
    else groups.push({ at: change.at, by: change.by, ...(change.name === undefined ? {} : { name: change.name }), model: change.model, changes: [change] })
  }
  return groups.map((group) => ({ ...group, changes: folded(group.changes) })).filter((group) => group.changes.length > 0)
}

const ONE_A_CHANGE: ReadonlySet<ChangeField> = new Set(['label', 'blocks', 'blockedBy', 'relates', 'subtask'])

function folded(changes: TaskChange[]): TaskChange[] {
  const rows: TaskChange[] = []
  for (const change of changes) {
    if (ONE_A_CHANGE.has(change.field)) {
      const name = (change.to ?? change.from ?? '').toLocaleLowerCase()
      const undone = rows.findIndex((row) => row.field === change.field && (row.to !== null) !== (change.to !== null) && (row.to ?? row.from ?? '').toLocaleLowerCase() === name)
      if (undone >= 0) rows.splice(undone, 1)
      else rows.push(change)
      continue
    }
    const earlier = change.field === 'description' || change.field === 'created' || change.field === 'moved' ? -1 : rows.findIndex((row) => row.field === change.field)
    if (earlier < 0) {
      rows.push(change)
      continue
    }
    const first = rows[earlier]!
    if (first.from === change.to) rows.splice(earlier, 1)
    else rows[earlier] = { ...first, to: change.to }
  }
  return rows
}
