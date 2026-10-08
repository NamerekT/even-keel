import type { McpRow, SettingKind, SettingRow, ToolScope, ToolsView } from '../../../src/tools/model.js'

export const HIDDEN = 'user-invocable-only'

const KIND_ORDER: SettingKind[] = ['sync', 'mode', 'plugin', 'skill', 'permission']
const SCOPES: ToolScope[] = ['user', 'project', 'local', 'chain']
/** What a worktree session reads, the strongest first: the main checkout's `settings.local.json` is not among them. */
const SESSION_SCOPES: ToolScope[] = ['chain', 'project', 'user']

export interface MatrixRow<T> {
  key: string
  name: string
  /** One cell per project, in the order of the views; `null` — the project has no such row. */
  cells: (T | null)[]
}

export function settingMatrix(views: ToolsView[], kinds: SettingKind[]): MatrixRow<SettingRow>[] {
  return matrix(
    views.map((view) => view.settings.filter((row) => kinds.includes(row.kind))),
    (row) => `${row.kind}\u0000${row.name}`,
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name),
  )
}

export function mcpMatrix(views: ToolsView[]): MatrixRow<McpRow>[] {
  return matrix(
    views.map((view) => view.mcp),
    (row) => `${row.scope}\u0000${row.plugin ?? ''}\u0000${row.name}`,
    (a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope),
  )
}

function matrix<T extends { name: string }>(lists: T[][], keyOf: (row: T) => string, order: (a: T, b: T) => number): MatrixRow<T>[] {
  const rows = new Map<string, { first: T; cells: (T | null)[] }>()
  lists.forEach((list, column) => {
    for (const row of list) {
      const key = keyOf(row)
      const entry = rows.get(key) ?? { first: row, cells: lists.map(() => null) }
      entry.cells[column] = row
      rows.set(key, entry)
    }
  })
  return [...rows.entries()]
    .sort(([, a], [, b]) => order(a.first, b.first))
    .map(([key, { first, cells }]) => ({ key, name: first.name, cells }))
}

export type McpState = 'on' | 'disabled' | 'outside'

export function mcpState(row: McpRow): McpState {
  if (row.disabled) return 'disabled'
  return row.worktree ? 'on' : 'outside'
}

function cellValue(cell: SettingRow | McpRow | null): string {
  if (cell === null) return '\u0000none'
  if ('session' in cell) return cell.session ?? '\u0000lost'
  return mcpState(cell)
}

export function filterRows<T extends SettingRow | McpRow>(rows: MatrixRow<T>[], { query, onlyDiff }: { query: string; onlyDiff: boolean }): MatrixRow<T>[] {
  const needle = query.trim().toLowerCase()
  return rows.filter(
    (row) => (needle === '' || row.name.toLowerCase().includes(needle)) && (!onlyDiff || new Set(row.cells.map(cellValue)).size > 1),
  )
}

export type ScopeEffect = 'wins' | 'same' | 'overridden' | 'unread'

export function scopeMarks(row: SettingRow): { scope: ToolScope; value: string; effect: ScopeEffect }[] {
  const winner = SESSION_SCOPES.find((scope) => row.values[scope] !== undefined)
  return SCOPES.flatMap((scope) => {
    const value = row.values[scope]
    if (value === undefined) return []
    const effect: ScopeEffect = scope === 'local' ? 'unread' : scope === winner ? 'wins' : value === row.session ? 'same' : 'overridden'
    return [{ scope, value, effect }]
  })
}

export interface Problems {
  unreached: SettingRow[]
  claudeai: string[]
  mcpFailed: string[]
  mcpOutside: string[]
}

export function problemsOf(view: ToolsView): Problems {
  return {
    unreached: view.settings.filter((row) => row.session === null),
    claudeai: (view.received?.skills ?? []).filter((skill) => skill.source === 'claudeai').map((skill) => skill.name),
    mcpFailed: (view.received?.mcp ?? []).filter((server) => server.failed).map((server) => server.name),
    mcpOutside: view.mcp.filter((row) => mcpState(row) === 'outside').map((row) => row.name),
  }
}

export function problemCount(problems: Problems): number {
  return problems.unreached.length + problems.claudeai.length + problems.mcpFailed.length + problems.mcpOutside.length
}

export const PROBLEM_KINDS = ['unreached', 'claudeai', 'mcpFailed', 'mcpOutside'] as const

export interface SharedProblem {
  kind: (typeof PROBLEM_KINDS)[number]
  name: string
  projects: string[]
  /** The setting of the first project that has it, for `unreached`. */
  row: SettingRow | null
}

export function sharedProblems(views: ToolsView[]): SharedProblem[] {
  const found = new Map<string, SharedProblem>()
  for (const view of views) {
    const problems = problemsOf(view)
    for (const kind of PROBLEM_KINDS) {
      const entries: [string, SettingRow | null][] =
        kind === 'unreached' ? problems.unreached.map((row) => [row.name, row]) : problems[kind].map((name) => [name, null])
      for (const [name, row] of entries) {
        const key = `${kind}\u0000${row?.kind ?? ''}\u0000${name}`
        const entry = found.get(key) ?? { kind, name, projects: [], row }
        entry.projects.push(view.project)
        found.set(key, entry)
      }
    }
  }
  return [...found.values()].sort((a, b) => PROBLEM_KINDS.indexOf(a.kind) - PROBLEM_KINDS.indexOf(b.kind))
}

export function hiddenSkills(views: ToolsView[]): number {
  return new Set(views.flatMap((view) => view.settings.filter((row) => row.kind === 'skill' && row.values.chain === HIDDEN).map((row) => row.name))).size
}

export type Tone = 'on' | 'off' | 'hidden' | 'ask' | 'lost' | 'plain'

export function tone(value: string | null): Tone {
  if (value === null) return 'lost'
  if (value === 'on' || value === 'allow') return 'on'
  if (value === 'off' || value === 'deny') return 'off'
  if (value === HIDDEN) return 'hidden'
  return value === 'ask' ? 'ask' : 'plain'
}
