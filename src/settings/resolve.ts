import { DEFINITIONS, LABEL_PARSERS, definitionOf, type CheckContext, type SettingDefinition, type TaskLabel } from './registry.js'

/**
 * One value of a setting at one level. No row is inheritance; a row whose value is JSON `null` is a value
 * (`chain.active: null` — back to the categories of the statuses over a shared list).
 */
export interface SettingRow {
  key: string
  /** The project's id; `null` — Even Keel's own value. */
  project: string | null
  /** The entry of a qualified key (a provider for `models`); `''` when the key has none. */
  qualifier: string
  value: unknown
}

/** A project as the settings know it: its fields that are not settings. */
export interface ProjectRecord {
  id: string
  key: string
  name: string | null
  repo: string
  branch: string
  /** The raw values of the trackers' project keys the entry has (`github`, `linear`), checked once the tracker is known. */
  trackerProjects: Record<string, unknown>
}

/** Values by setting key; a qualified key's value is a map by qualifier. */
export type Values = Record<string, unknown>

export interface Resolved {
  /** Every key Even Keel sets: its row, else the default. */
  shared: Values
  /** By project id: only the project's own rows. */
  own: Record<string, Values>
  /** By project id: what the project ends up with — the task's label, the project's row, Even Keel's, the default. */
  values: Record<string, Values>
  warnings: string[]
}

/** The task whose labels feed the task level of its project's values. */
export interface TaskLabels {
  project: string
  id: string
  labels: string[]
}

/** The rows checked and normalized by their definitions; a row that says nothing (a blank model) is dropped. */
export function checkRows(rows: SettingRow[], records: ProjectRecord[], context: CheckContext): SettingRow[] {
  const keys = new Map(records.map((record) => [record.id, record.key]))
  return rows.flatMap((row) => {
    const definition = definitionOf(row.key)
    const project = row.project === null ? null : keys.get(row.project)
    if (project === undefined) throw new Error(`settings: ${row.key} is set for an unknown project ${row.project}`)
    if (!definition.scopes.includes(project === null ? 'global' : 'project')) throw new Error(`settings: ${row.key} is not set ${project === null ? 'for Even Keel' : 'per project'}`)
    if ((definition.qualifier === undefined) !== (row.qualifier === '')) throw new Error(`settings: ${row.key} takes ${definition.qualifier ?? 'no qualifier'}`)
    const value = definition.check(row.value, { project, qualifier: row.qualifier }, context)
    return value === undefined ? [] : [{ ...row, value }]
  })
}

/**
 * The value at the narrower level over the one it inherits: a qualified key entry by entry, any other whole. `own`
 * `undefined` — the level has no row.
 */
export function inherit(key: string, inherited: unknown, own: unknown): unknown {
  if (definitionOf(key).qualifier === undefined) return own === undefined ? inherited : own
  return { ...(inherited as Record<string, unknown>), ...(own as Record<string, unknown> | undefined) }
}

/** The values of every level: per qualifier for qualified keys; the task's labels, if given, as the narrowest level of its project. */
export function resolve(records: ProjectRecord[], rows: SettingRow[], task?: TaskLabels): Resolved {
  const levels = new Map<string | null, Values>()
  for (const { key, project, qualifier, value } of rows) {
    const level = levels.get(project) ?? levels.set(project, {}).get(project)!
    if (qualifier === '') level[key] = value
    else level[key] = { ...(level[key] as Record<string, unknown> | undefined), [qualifier]: value }
  }
  const builtIn = (definition: SettingDefinition) => (definition.default === undefined ? undefined : structuredClone(definition.default))
  const global = levels.get(null) ?? {}
  const shared: Values = {}
  for (const definition of DEFINITIONS) {
    if (definition.scopes.includes('global')) shared[definition.key] = inherit(definition.key, builtIn(definition), global[definition.key])
  }

  const own: Record<string, Values> = {}
  const values: Record<string, Values> = {}
  const warnings: string[] = []
  for (const { id } of records) {
    own[id] = levels.get(id) ?? {}
    const project: Values = {}
    for (const definition of DEFINITIONS) {
      const inherited = definition.scopes.includes('global') ? structuredClone(shared[definition.key]) : builtIn(definition)
      project[definition.key] = definition.scopes.includes('project') ? inherit(definition.key, inherited, own[id][definition.key]) : inherited
    }
    if (task?.project === id) warnings.push(...withLabels(project, task))
    values[id] = project
  }
  return { shared, own, values, warnings }
}

/** Puts what the task's labels set over the project's values; the warnings of labels that contradict each other. */
function withLabels(values: Values, task: TaskLabels): string[] {
  const parsers = new Set(DEFINITIONS.flatMap((definition) => (definition.taskLabel === undefined ? [] : [definition.taskLabel])))
  const warnings: string[] = []
  for (const name of parsers) {
    const parser = LABEL_PARSERS[name as TaskLabel]
    if (parser.switch !== undefined && values[parser.switch] !== true) continue
    const read = parser.read(task.labels)
    if ('clash' in read) {
      warnings.push(`settings: ${task.id} carries labels ${read.clash.join(', ')} that contradict each other; launching it as its project says`)
      continue
    }
    for (const { key, qualifier, value } of read.values) {
      values[key] = inherit(key, values[key], qualifier === '' ? value : { [qualifier]: value })
    }
  }
  return warnings
}
