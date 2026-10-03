import type { RuleKind, RuleSet, RuleSetFile, ScopePlaces } from './rules.js'

export const RULE_PURPOSES = ['economy', 'quality', 'process', 'infra'] as const
export type RulePurpose = (typeof RULE_PURPOSES)[number]

export const IMPORT_PRECISIONS = ['exact', 'hour', 'day'] as const
export type ImportPrecision = (typeof IMPORT_PRECISIONS)[number]

export const IMPORT_ACTIONS = ['added', 'changed', 'removed'] as const
export type ImportAction = (typeof IMPORT_ACTIONS)[number]

export interface ImportFile {
  path: string
  action: ImportAction
  summary: string
  precision: ImportPrecision | null
  at: string | null
}

// One set of rule edits from the history import (`rule-history.jsonl`), written by hand or by another agent.
export interface RuleImport {
  id: string
  at: string
  until: string | null
  precision: ImportPrecision
  sessions: string[]
  files: ImportFile[]
  purpose: RulePurpose[]
  reason: string
  task: string | null
  source: string
}

// What the import says about a set. `drift` — how far the transcript set lies from the import window, in ms
// (positive: the transcript is later); set on both the transcript set and the import's own set.
export interface RuleNote {
  importId: string
  at: string
  until: string | null
  precision: ImportPrecision
  purpose: RulePurpose[]
  reason: string
  task: string | null
  files: ImportFile[]
  drift: number | null
}

export interface SetFilter {
  kinds: RuleKind[] | null
  projects: string[] | null
  purposes: RulePurpose[] | null
}

const HOUR = 3_600_000
const TOLERANCE: Record<ImportPrecision, number> = { exact: HOUR / 2, hour: HOUR, day: 24 * HOUR }
const KIND_SIGNS: [RegExp, RuleKind][] = [
  [/claude\.md/i, 'claude_md'],
  [/memory/i, 'memory'],
  [/skills?\b/i, 'skill'],
  [/hooks/i, 'hook'],
  [/settings|\.claude\.json/i, 'settings'],
  [/agents/i, 'agent'],
]

// Import paths are free text («Gamma/CLAUDE.md и docs»): the kind named first wins, tools and the like count as settings.
export function importKind(path: string): RuleKind {
  let best: { index: number; kind: RuleKind } | null = null
  for (const [sign, kind] of KIND_SIGNS) {
    const index = path.search(sign)
    if (index >= 0 && (best === null || index < best.index)) best = { index, kind }
  }
  return best?.kind ?? 'settings'
}

// Home paths are global. Elsewhere any word of the path may name a Baton project (key or folder) or a folder
// group; a path naming none is shown with every project, like a global one.
export function importProjects(path: string, places: ScopePlaces): (string | null)[] {
  if (/^(~|\$HOME)[\\/]/.test(path)) return [null]
  const words = path.toLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter(Boolean)
  const found: string[] = []
  for (const word of words) {
    const baton = places.baton.find((each) => each.key.toLowerCase() === word || each.dir.split('/').at(-1) === word)
    const project = baton?.key ?? places.folders.find((each) => each.label.toLowerCase() === word)?.label
    if (project !== undefined && !found.includes(project)) found.push(project)
  }
  return found.length === 0 ? [null] : found
}

function noteOf(entry: RuleImport, drift: number | null): RuleNote {
  const { id, at, until, precision, purpose, reason, task, files } = entry
  return { importId: id, at, until, precision, purpose, reason, task, files, drift }
}

// Signed distance from the import window to the span of a set, 0 when they overlap; within the precision of
// the import it counts as no drift.
function driftOf(entry: RuleImport, set: RuleSet): number {
  const from = Date.parse(entry.at)
  const to = Date.parse(entry.until ?? entry.at)
  const drift = Date.parse(set.startAt) > to ? Date.parse(set.startAt) - to : Date.parse(set.at) < from ? Date.parse(set.at) - from : 0
  return Math.abs(drift) <= TOLERANCE[entry.precision] ? 0 : drift
}

// A transcript set of one of the import's sessions takes its purpose, reason and task when their times agree.
// An import no set agrees with becomes a set of its own; a set of its sessions that disagrees keeps the drift.
export function withImports(sets: RuleSet[], imports: RuleImport[], places: ScopePlaces): RuleSet[] {
  const result = sets.map((each) => ({ ...each }))
  for (const entry of imports) {
    const own = result.filter((each) => each.sessionId !== null && entry.sessions.some((prefix) => each.sessionId!.startsWith(prefix)))
    const drifts = own.map((each) => driftOf(entry, each))
    for (const [index, each] of own.entries()) {
      const drift = drifts[index]!
      if (drift === 0) {
        each.note = noteOf(entry, null)
        each.task ??= entry.task
      } else if (each.note === null) each.note = noteOf(entry, drift)
    }
    if (drifts.includes(0)) continue
    const nearest = drifts.length === 0 ? null : drifts.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a))
    result.push({
      id: `i:${entry.id}`,
      startAt: entry.at,
      at: entry.until ?? entry.at,
      sessionId: null,
      task: entry.task,
      title: null,
      files: entry.files.flatMap((file) =>
        importProjects(file.path, places).map((project): RuleSetFile => ({
          key: `import:${entry.id}:${file.path.toLowerCase()}`,
          display: file.path,
          kind: importKind(file.path),
          project,
          added: 0,
          removed: 0,
          changes: [],
        })),
      ),
      note: noteOf(entry, nearest),
    })
  }
  return result.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id))
}

// Global files stay with any project filter; a set left without files or without an asked purpose is dropped.
// Memory never makes a mark: sessions write it all the time, and its marks left too little between them to compare.
export function filterSets(sets: RuleSet[], filter: SetFilter): RuleSet[] {
  return sets.flatMap((each) => {
    if (filter.purposes !== null && !(each.note?.purpose ?? []).some((purpose) => filter.purposes!.includes(purpose))) return []
    const files = each.files.filter(
      (file) =>
        file.kind !== 'memory' &&
        (filter.kinds === null || filter.kinds.includes(file.kind)) &&
        (file.project === null || filter.projects === null || filter.projects.includes(file.project)),
    )
    return files.length === 0 ? [] : [{ ...each, files }]
  })
}
