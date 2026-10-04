import { lineDiff, type DiffHunk } from './diff.js'
import { parseStatsFilter, type StatsFilter } from './model.js'
import { RULE_PURPOSES, type RuleNote, type RulePurpose } from './rule-imports.js'

export const RULE_KINDS = ['claude_md', 'skill', 'memory', 'hook', 'settings', 'agent'] as const
export type RuleKind = (typeof RULE_KINDS)[number]

interface RuleFile {
  key: string
  display: string
  kind: RuleKind
  project: string | null
}

export interface RuleChangeRow extends RuleFile {
  id: string
  at: string
  added: number
  removed: number
}

export interface RuleEditRow extends RuleFile {
  sessionId: string
  at: string
  added: number
  removed: number | null
}

export interface RuleSetFile extends RuleFile {
  added: number
  removed: number
  changes: string[]
}

// `startAt` — the first edit of the set, `at` — the last one.
export interface RuleSet {
  id: string
  startAt: string
  at: string
  sessionId: string | null
  task: string | null
  title: string | null
  files: RuleSetFile[]
  note: RuleNote | null
}

export interface RuleMark {
  fromAt: string
  toAt: string
  sets: RuleSet[]
}

export interface CompareSettings {
  minTasks: number
  minSessions: number
  days: number
}

export interface StatsRules {
  at: string
  marks: RuleMark[]
  compare: CompareSettings
}

export interface RuleDiffFile {
  key: string
  display: string
  kind: RuleKind
  fromAt: string
  toAt: string
  added: number
  removed: number
  hunks: DiffHunk[]
}

export interface CompareSide {
  from: string
  to: string
  tasks: number
  sessions: number
  taskCost: number | null
  sessionsPerTask: number | null
  stuckShare: number | null
  errorShare: number | null
  deniedShare: number | null
  entryTokens: number | null
  requests: number
  meanContext: number | null
  over150Share: number | null
  requestCost: number | null
  models: { model: string; share: number }[]
}

export interface StatsCompare {
  days: number
  thin: boolean
  modelShift: boolean
  minTasks: number
  minSessions: number
  before: CompareSide
  after: CompareSide
}

export interface SideSums {
  tasks: number
  sessions: number
  taskCost: number | null
  sessionsPerTask: number | null
  cost: number
  stuckCost: number
  calls: number
  errors: number
  denied: number
  entryTokens: number | null
  requests: number
  contextTokens: number
  over150: number
  requestCost: number
  models: { model: string; requests: number }[]
}

export interface ScopePlaces {
  tracked: { key: string; dir: string }[]
  folders: { dir: string; label: string }[]
}

export interface RulesQuery extends StatsFilter {
  projects: string[] | null
  kinds: RuleKind[] | null
  purposes: RulePurpose[] | null
}

export interface CompareQuery extends StatsFilter {
  before: string
  after: string
  days: number | null
  projects: string[] | null
}

const HOUR = 3_600_000
const EDIT_REACH = 72 * HOUR
const MANUAL_GAP = HOUR / 2
const CHANGE_ID = /^[0-9a-f]{40}$/
const MAX_DIFF_CHANGES = 500
// Half the summed difference of the model shares of the two sides; above it the price per token moved too.
const MODEL_SHIFT = 0.2

const holds = (outer: string, inner: string) => inner === outer || inner.startsWith(`${outer}/`)
const slugOf = (raw: string) => raw.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
const iso = (at: string) => new Date(at).toISOString()

// The stats project of a rule file scope: none for global rules, the Even Keel project holding the folder, else
// the group of the deepest folder seen in the data that holds it. A memory slug is matched without its drive.
export function scopeProject(scope: string, places: ScopePlaces): string | null {
  if (scope === 'global') return null
  let dir = scope
  if (scope.startsWith('slug:')) {
    const slug = scope.slice('slug:'.length)
    const folder = places.folders.find((each) => slugOf(each.dir) === slug.replace(/^[a-z]-/, ''))
    if (folder === undefined) return slug
    dir = folder.dir
  }
  const tracked = places.tracked.filter((each) => holds(each.dir, dir)).sort((a, b) => b.dir.length - a.dir.length)[0]
  if (tracked !== undefined) return tracked.key
  const folder = places.folders.filter((each) => holds(each.dir, dir)).sort((a, b) => b.dir.length - a.dir.length)[0]
  return folder?.label ?? dir.split('/').filter(Boolean).at(-1) ?? dir
}

function addFile(files: Map<string, RuleSetFile>, row: RuleFile, added: number, removed: number, change?: string): void {
  const file = files.get(row.key) ?? { key: row.key, display: row.display, kind: row.kind, project: row.project, added: 0, removed: 0, changes: [] }
  file.added += added
  file.removed += removed
  if (change !== undefined) file.changes.push(change)
  files.set(row.key, file)
}

// A change goes to the session with the last edit of its file at most three days before it. Each session
// with edits is one set; changes left without a session make sets of their own, 30 minutes apart at most.
export function ruleSets(
  changes: RuleChangeRow[],
  edits: RuleEditRow[],
  sessions: Map<string, { task: string | null; title: string | null }>,
): RuleSet[] {
  const ordered = [...edits].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const owned = new Map<string, RuleChangeRow[]>()
  const loose: RuleChangeRow[] = []
  for (const change of changes) {
    const at = Date.parse(change.at)
    const owner = ordered.findLast((each) => each.key === change.key && Date.parse(each.at) <= at && at - Date.parse(each.at) <= EDIT_REACH)
    if (owner === undefined) loose.push(change)
    else owned.set(`${owner.sessionId}|${change.key}`, [...(owned.get(`${owner.sessionId}|${change.key}`) ?? []), change])
  }

  const bySession = new Map<string, RuleEditRow[]>()
  for (const each of ordered) bySession.set(each.sessionId, [...(bySession.get(each.sessionId) ?? []), each])
  const sets: RuleSet[] = []
  for (const [sessionId, own] of bySession) {
    const files = new Map<string, RuleSetFile>()
    for (const each of own) {
      const attached = owned.get(`${sessionId}|${each.key}`)
      if (attached === undefined) addFile(files, each, each.added, each.removed ?? 0)
      else if (!files.has(each.key)) for (const change of attached) addFile(files, change, change.added, change.removed, change.id)
    }
    const info = sessions.get(sessionId)
    sets.push({
      id: `s:${sessionId}`,
      startAt: iso(own[0]!.at),
      at: iso(own.at(-1)!.at),
      sessionId,
      task: info?.task ?? null,
      title: info?.title ?? null,
      files: [...files.values()],
      note: null,
    })
  }

  loose.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  let group: RuleChangeRow[] = []
  const flush = () => {
    if (group.length === 0) return
    const files = new Map<string, RuleSetFile>()
    for (const change of group) addFile(files, change, change.added, change.removed, change.id)
    sets.push({ id: `m:${group[0]!.id}`, startAt: iso(group[0]!.at), at: iso(group.at(-1)!.at), sessionId: null, task: null, title: null, files: [...files.values()], note: null })
    group = []
  }
  for (const change of loose) {
    if (group.length > 0 && Date.parse(change.at) - Date.parse(group.at(-1)!.at) > MANUAL_GAP) flush()
    group.push(change)
  }
  flush()
  return sets.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))
}

// Neighbouring sets merge into one mark while fewer than `minSessions` sessions started between them.
// A mark goes from the first edit of its first set to the last edit of its last one.
// `starts` are session start times in milliseconds, sorted.
export function mergeMarks(sets: RuleSet[], starts: number[], minSessions: number): RuleMark[] {
  const marks: RuleMark[] = []
  const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b)
  for (const each of [...sets].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))) {
    const last = marks.at(-1)
    if (last !== undefined && countBetween(starts, Date.parse(last.toAt), Date.parse(each.startAt)) < minSessions) {
      last.toAt = later(last.toAt, each.at)
      last.sets.push(each)
    } else marks.push({ fromAt: each.startAt, toAt: each.at, sets: [each] })
  }
  return marks
}

function countBetween(sorted: number[], from: number, to: number): number {
  return lowerBound(sorted, to) - lowerBound(sorted, from + 1)
}

function lowerBound(sorted: number[], value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function compareOf(
  sides: Record<'before' | 'after', { from: string; to: string }>,
  sums: Partial<Record<'before' | 'after', SideSums>>,
  settings: CompareSettings,
): StatsCompare {
  const empty: SideSums = {
    tasks: 0,
    sessions: 0,
    taskCost: null,
    sessionsPerTask: null,
    cost: 0,
    stuckCost: 0,
    calls: 0,
    errors: 0,
    denied: 0,
    entryTokens: null,
    requests: 0,
    contextTokens: 0,
    over150: 0,
    requestCost: 0,
    models: [],
  }
  const before = sums.before ?? empty
  const after = sums.after ?? empty
  const thin = [before, after].some((each) => each.tasks < settings.minTasks || each.sessions < settings.minSessions)
  const side = (range: { from: string; to: string }, each: SideSums): CompareSide => {
    const share = (part: number, whole: number) => (thin || whole === 0 ? null : part / whole)
    return {
      ...range,
      tasks: each.tasks,
      sessions: each.sessions,
      taskCost: thin ? null : each.taskCost,
      sessionsPerTask: thin ? null : each.sessionsPerTask,
      stuckShare: share(each.stuckCost, each.cost),
      errorShare: share(each.errors, each.calls),
      deniedShare: share(each.denied, each.calls),
      entryTokens: thin ? null : each.entryTokens,
      requests: each.requests,
      meanContext: share(each.contextTokens, each.requests),
      over150Share: share(each.over150, each.requests),
      requestCost: share(each.requestCost, each.requests),
      models: modelShares(each.models),
    }
  }
  const was = new Map(modelShares(before.models).map((each) => [each.model, each.share]))
  const next = new Map(modelShares(after.models).map((each) => [each.model, each.share]))
  const moved = [...new Set([...was.keys(), ...next.keys()])].reduce((sum, model) => sum + Math.abs((was.get(model) ?? 0) - (next.get(model) ?? 0)), 0) / 2
  return {
    days: settings.days,
    thin,
    modelShift: was.size > 0 && next.size > 0 && moved > MODEL_SHIFT,
    minTasks: settings.minTasks,
    minSessions: settings.minSessions,
    before: side(sides.before, before),
    after: side(sides.after, after),
  }
}

function modelShares(models: { model: string; requests: number }[]): { model: string; share: number }[] {
  const total = models.reduce((sum, each) => sum + each.requests, 0)
  if (total === 0) return []
  return models
    .filter((each) => each.requests > 0)
    .map((each) => ({ model: each.model, share: each.requests / total }))
    .sort((a, b) => b.share - a.share || a.model.localeCompare(b.model))
}

// Each file goes from the text before its first change to the text after its last one.
export function ruleDiff(
  changes: { key: string; display: string; kind: RuleKind; at: string; oldHash: string | null; newHash: string | null }[],
  texts: Map<string, string>,
): RuleDiffFile[] {
  const byKey = new Map<string, typeof changes>()
  for (const change of [...changes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) byKey.set(change.key, [...(byKey.get(change.key) ?? []), change])
  const text = (hash: string | null) => (hash === null ? null : (texts.get(hash) ?? null))
  return [...byKey.values()].map((list) => {
    const first = list[0]!
    const last = list.at(-1)!
    const diff = lineDiff(text(first.oldHash), text(last.newHash))
    return { key: first.key, display: first.display, kind: first.kind, fromAt: iso(first.at), toAt: iso(last.at), ...diff }
  })
}

function listParam(params: URLSearchParams, name: string): string[] | null {
  const listed = params.get(name)
  return listed === null ? null : listed.split(',').filter((each) => each !== '')
}

function knownList<T extends string>(params: URLSearchParams, name: string, known: readonly T[]): T[] | null {
  const listed = listParam(params, name)
  const unknown = listed?.find((each) => !(known as readonly string[]).includes(each))
  if (unknown !== undefined) throw new Error(`${name} must be among ${known.join(', ')}, got ${unknown}`)
  return listed as T[] | null
}

export function parseRulesQuery(params: URLSearchParams): RulesQuery {
  return {
    ...parseStatsFilter(params),
    projects: listParam(params, 'projects'),
    kinds: knownList(params, 'kinds', RULE_KINDS),
    purposes: knownList(params, 'purposes', RULE_PURPOSES),
  }
}

export function parseCompareQuery(params: URLSearchParams): CompareQuery {
  const moment = (name: string) => {
    const value = params.get(name) ?? ''
    const time = Date.parse(value)
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) || Number.isNaN(time)) throw new Error(`${name} must be a UTC time like 2026-09-10T10:00:00Z`)
    return new Date(time).toISOString()
  }
  const before = moment('before')
  const after = moment('after')
  if (after < before) throw new Error('after must not be before before')
  const raw = params.get('days')
  const days = raw === null || raw === '' ? null : Number(raw)
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw new Error('days must be an integer in 1..365')
  return { ...parseStatsFilter(params), before, after, days, projects: listParam(params, 'projects') }
}

export function parseChangeIds(params: URLSearchParams): string[] {
  const ids = listParam(params, 'changes') ?? []
  if (ids.length === 0 || ids.length > MAX_DIFF_CHANGES || ids.some((id) => !CHANGE_ID.test(id))) {
    throw new Error(`changes must list 1..${MAX_DIFF_CHANGES} change ids`)
  }
  return ids
}
