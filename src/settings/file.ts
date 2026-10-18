import { fail } from '../notice/notice.js'
import { refuseNewer } from '../storage/schema.js'
import type { RowChange } from './changes.js'
import { CONFIG_FILE, DEFAULT_BRANCH } from './defaults.js'
import { at, DEFINITIONS, OBJECTS, type Scope } from './registry.js'
import type { ProjectRecord, SettingRow } from './resolve.js'

const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,4}$/
// What `git check-ref-format --branch` refuses, short of the rarest cases.
export const BRANCH = /^(?!-)(?!.*\.\.)(?!.*@\{)(?!.*\/\/)(?!.*\/\.)(?!\.)[^\s~^:?*[\\\x00-\x1f\x7f]+(?<![/.])(?<!\.lock)$/

export interface FileContents {
  records: ProjectRecord[]
  /** Unchecked: `checkRows` checks them by the registry. */
  rows: SettingRow[]
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The project records and the rows of the file: the top level is Even Keel's rows, each entry of `projects` a record and
 * its rows. The shape is checked here — nested objects, their unknown keys, the records; the values are left to
 * `checkRows`.
 */
export function fileRows(raw: unknown, trackerKeys: string[]): FileContents {
  const input = (raw ?? {}) as Record<string, unknown>
  parseVersion(input.version)
  if (!Array.isArray(input.projects)) throw fail('config.projects', {})
  const rows = levelRows(input, null, null, 'global')
  const records: ProjectRecord[] = []
  const placeOf: Record<string, string> = {}
  for (const [index, fields] of (input.projects as unknown[]).entries()) {
    const record = recordOf(fields, `projects[${index}]`, placeOf, trackerKeys)
    records.push(record)
    rows.push(...levelRows(fields as Record<string, unknown>, record.id, record.key, 'project'))
  }
  return { records, rows }
}

/** Even Keel's own rows of the file, without its projects. */
export function sharedRows(raw: unknown): SettingRow[] {
  return levelRows(isPlainObject(raw) ? raw : {}, null, null, 'global')
}

function parseVersion(raw: unknown): void {
  if (raw === undefined) return
  if (!Number.isInteger(raw) || (raw as number) < 1) throw fail('config.version', { value: String(JSON.stringify(raw)) })
  refuseNewer(CONFIG_FILE, raw as number)
}

function recordOf(fields: unknown, place: string, placeOf: Record<string, string>, trackerKeys: string[]): ProjectRecord {
  if (!isPlainObject(fields)) throw fail('config.projectEntry', { where: place })
  const { id, key, repo, name, branch } = fields
  if (typeof key !== 'string' || !PROJECT_KEY.test(key)) throw fail('config.projectKey', { where: `${place}.key`, value: String(JSON.stringify(key)) })
  if (typeof id !== 'string' || id.trim() === '') throw fail('config.projectId', { where: `${place}.id` })
  for (const [field, value] of [['key', key], ['id', id]] as const) {
    const first = placeOf[`${field}:${value}`]
    if (first !== undefined) throw fail('config.projectTwice', { field, value: JSON.stringify(value), first, second: place })
    placeOf[`${field}:${value}`] = place
  }
  if (typeof repo !== 'string' || repo === '') throw fail('config.repoEmpty', { key })
  if (name !== undefined && typeof name !== 'string') throw fail('config.projectName', { where: `${key}.name` })
  const trackerProjects = Object.fromEntries(trackerKeys.flatMap((field) => (fields[field] === undefined ? [] : [[field, fields[field]]])))
  return { id, key, name: typeof name === 'string' && name.trim() !== '' ? name.trim() : null, repo, branch: parseBranch(branch, `${key}.branch`), trackerProjects }
}

function parseBranch(raw: unknown, where: string): string {
  if (raw === undefined) return DEFAULT_BRANCH
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!BRANCH.test(name)) throw fail('config.branch', { where, value: String(JSON.stringify(raw)) })
  return name
}

/** The rows of one level: the top of the file or a project's entry. Keys of the other level are not read. */
function levelRows(source: Record<string, unknown>, id: string | null, key: string | null, scope: Scope): SettingRow[] {
  const place = { project: key, qualifier: '' }
  const definitions = DEFINITIONS.filter((definition) => definition.scopes.includes(scope))
  const checked = new Set<string>()
  for (const { key: path } of definitions) {
    const parts = path.split('.')
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = parts.slice(0, depth).join('.')
      if (checked.has(parent)) continue
      checked.add(parent)
      const value = valueAt(source, parent)
      if (value === undefined) continue
      const where = at(place, parent)
      if (!isPlainObject(value)) throw fail('config.notObject', { where })
      const known = [...new Set(definitions.flatMap((each) => (each.key.startsWith(`${parent}.`) ? [each.key.slice(parent.length + 1).split('.')[0]!] : [])))]
      const unknown = Object.keys(value).find((child) => !known.includes(child))
      const refuse = OBJECTS[parent]?.unknown
      if (unknown !== undefined && refuse !== undefined) throw refuse(where, unknown, known)
    }
  }

  const rows: SettingRow[] = []
  for (const definition of definitions) {
    const value = valueAt(source, definition.key)
    if (value === undefined) continue
    if (definition.qualifier === undefined) {
      rows.push({ key: definition.key, project: id, qualifier: '', value })
      continue
    }
    if (!isPlainObject(value)) throw fail('config.notObject', { where: at(place, definition.key) })
    for (const [qualifier, entry] of Object.entries(value)) rows.push({ key: definition.key, project: id, qualifier, value: entry })
  }
  return rows
}

function valueAt(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source
  for (const part of path.split('.')) {
    if (!isPlainObject(value)) return undefined
    value = value[part]
  }
  return value
}

const pathOf = (key: string, qualifier: string) => [...key.split('.'), ...(qualifier === '' ? [] : [qualifier])]

/**
 * The raw config with the changes written: a set at its JSON path, an unset removed along with the objects it leaves
 * empty. Every key no change names stays as written.
 */
export function withRows(raw: unknown, changes: RowChange[]): Record<string, unknown> {
  let config: Record<string, unknown> = { ...(isPlainObject(raw) ? raw : {}) }
  for (const change of changes) {
    if (change.project === null) {
      config = writeRows(config, [change])
      continue
    }
    const projects = Array.isArray(config.projects) ? (config.projects as unknown[]) : []
    const index = projects.findIndex((entry) => isPlainObject(entry) && entry.id === change.project)
    if (index < 0) throw fail('config.unknownProject', { key: change.project })
    config = { ...config, projects: projects.map((entry, at) => (at === index ? writeRows(entry as Record<string, unknown>, [change]) : entry)) }
  }
  return config
}

/** One level of the file — its top or a project's entry — with the changes written, whoever's level they name. */
export function writeRows(target: Record<string, unknown>, changes: RowChange[]): Record<string, unknown> {
  return changes.reduce((next, change) => {
    const path = pathOf(change.key, change.qualifier)
    return change.op === 'set' ? setIn(next, path, change.value) : unsetIn(next, path)
  }, target)
}

function setIn(target: Record<string, unknown>, [part, ...rest]: string[], value: unknown): Record<string, unknown> {
  const next = { ...target }
  next[part!] = rest.length === 0 ? value : setIn(isPlainObject(target[part!]) ? (target[part!] as Record<string, unknown>) : {}, rest, value)
  return next
}

function unsetIn(target: Record<string, unknown>, [part, ...rest]: string[]): Record<string, unknown> {
  if (!Object.hasOwn(target, part!)) return target
  const next = { ...target }
  if (rest.length === 0) {
    delete next[part!]
    return next
  }
  const child = target[part!]
  if (!isPlainObject(child)) return target
  const inner = unsetIn(child, rest)
  if (inner === child) return target
  if (Object.keys(inner).length === 0) delete next[part!]
  else next[part!] = inner
  return next
}
