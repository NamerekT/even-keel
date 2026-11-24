import { EFFORTS, isProvider, PROVIDERS } from '../agent/providers.js'
import { fail } from '../notice/notice.js'
import { isOpen, runLabelOf, type RunLabel, type Task } from '../tracker/model.js'

/**
 * What a task's sessions run on, kept by Even Keel and not by the tracker (BTN-983). A `null` field is "as the project
 * says"; a model needs its provider, an effort does not: it goes to whatever provider the task runs on, if that takes it.
 */
export interface TaskRun {
  provider: string | null
  /** As written, for the CLI: a typo is the session's error on its first turn. */
  model: string | null
  /** One of `EFFORTS` of the provider; `null` — Even Keel passes none. */
  effort: string | null
  /**
   * The machines of the pool the task is pinned to, by id, each once (BTN-1623, `docs/machines.md`, "A task pinned to
   * machines"): the chain gives it to no other. Absent — any machine; never an empty list.
   */
  machines?: string[]
}

export interface StoredRun extends TaskRun {
  project: string
  task: string
}

const blank = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

/**
 * The run a page command or a tasks server call names, checked; `null` — nothing is set, the task runs as its project
 * says. Throws `run.*` notices.
 */
export function taskRunOf(raw: { provider?: unknown; model?: unknown; effort?: unknown; machines?: unknown }): TaskRun | null {
  for (const field of ['provider', 'model', 'effort'] as const) {
    if (!blank(raw[field]) && typeof raw[field] !== 'string') throw fail('request.required', { field })
  }
  const machines = machinesOf(raw.machines)
  const provider = blank(raw.provider) ? null : (raw.provider as string).trim().toLowerCase()
  const model = blank(raw.model) ? null : (raw.model as string).trim()
  const effort = blank(raw.effort) ? null : (raw.effort as string).trim().toLowerCase()
  if (provider !== null && !isProvider(provider)) throw fail('run.unknownProvider', { provider, known: [...PROVIDERS] })
  if (model !== null && provider === null) throw fail('run.modelWithoutProvider', { model })
  if (effort !== null) {
    const known = provider === null ? [...new Set(Object.values(EFFORTS).flat())] : (EFFORTS[provider] ?? [])
    if (!known.includes(effort)) throw fail('run.unknownEffort', { effort, provider: provider ?? '', known: [...known] })
  }
  if (provider === null && effort === null && machines.length === 0) return null
  return { provider, model, effort, ...(machines.length > 0 && { machines }) }
}

/** The machine ids a run names, trimmed, each once; none — `[]`. */
function machinesOf(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.some((each) => typeof each !== 'string')) throw fail('request.required', { field: 'machines' })
  return [...new Set((raw as string[]).map((each) => each.trim()).filter((each) => each !== ''))]
}

export const RUN_FIELDS = ['provider', 'model', 'effort'] as const

/** A change of a run: the fields named, `null` to clear one; `machines` are ids here, a tasks server call's names resolved. */
export type RunPatch = Partial<Record<(typeof RUN_FIELDS)[number], string | null>> & { machines?: string[] | null }

/**
 * The run after a change, checked as `taskRunOf` checks it; `null` — nothing is left set. A new provider drops the
 * model the change does not name: a model is its provider's.
 */
export function patchedRun(current: TaskRun | undefined, patch: RunPatch): TaskRun | null {
  const provider = 'provider' in patch ? patch.provider : current?.provider
  const moved = 'provider' in patch && (patch.provider ?? null)?.trim().toLowerCase() !== (current?.provider ?? null)
  const model = 'model' in patch ? patch.model : moved ? null : current?.model
  const effort = 'effort' in patch ? patch.effort : current?.effort
  const machines = 'machines' in patch ? patch.machines : current?.machines
  return taskRunOf({ provider, model, effort, machines })
}

export function sameRun(one: TaskRun | null | undefined, other: TaskRun | null | undefined): boolean {
  const pins = (run: TaskRun | null | undefined) => [...(run?.machines ?? [])].sort().join('\n')
  return RUN_FIELDS.every((field) => (one?.[field] ?? null) === (other?.[field] ?? null)) && pins(one) === pins(other)
}

/** The run's fields without its record's project and task, the machines only where there are some. */
export function runFields(run: TaskRun): TaskRun {
  return { provider: run.provider, model: run.model, effort: run.effort, ...(run.machines !== undefined && run.machines.length > 0 && { machines: [...run.machines] }) }
}

/** The effort a session of the provider gets for the run: none where the provider does not take that level. */
export function effortFor(run: TaskRun | undefined, provider: string): string | null {
  const effort = run?.effort ?? null
  return effort !== null && EFFORTS[provider]?.includes(effort) === true ? effort : null
}

/** A provider whose short name is not its key capitalised. */
const RUN_NAMES: Record<string, string> = { opencode: 'OpenCode' }

/** The run as the page and a tasks server answer name it: `Claude | opus · high`, `Codex`, `high`. */
export function taskRunText({ provider, model, effort }: TaskRun): string {
  const name = provider === null ? null : (RUN_NAMES[provider] ?? `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`)
  const run = name === null ? null : model === null ? name : `${name} | ${model}`
  return [run, effort].filter((part) => part !== null).join(' · ')
}

export interface RunStore {
  save: (run: StoredRun) => void
  drop: (project: string, task: string) => void
  /** The project's run labels are moved: its mark goes. */
  imported: (project: string) => void
}

const keyOf = (project: string, task: string) => `${project}\n${task}`

/**
 * The runs of the tasks, by project id and task, in memory and written behind into `task_runs` (`runs-store.ts`, step 47,
 * `docs/storage.md`). `pending` are the projects that read run labels before the update: the first list of each of a
 * project's readers moves the run label of each open task into a run, once (`importLabels`).
 */
export class TaskRuns {
  private readonly runs = new Map<string, StoredRun>()
  private readonly pending: Set<string>
  /** By pending project: the readers whose labels are moved this run. */
  private readonly movedReaders = new Map<string, Set<string>>()

  constructor(
    loaded: StoredRun[] = [],
    pending: string[] = [],
    private readonly store: RunStore = { save: () => {}, drop: () => {}, imported: () => {} },
  ) {
    for (const run of loaded) this.runs.set(keyOf(run.project, run.task), run)
    this.pending = new Set(pending)
  }

  of(project: string, task: string): TaskRun | undefined {
    const run = this.runs.get(keyOf(project, task))
    return run === undefined ? undefined : runFields(run)
  }

  /** `null` — the task runs as its project says again. */
  set(project: string, task: string, run: TaskRun | null): void {
    if (run === null) {
      if (this.runs.delete(keyOf(project, task))) this.store.drop(project, task)
      return
    }
    const stored = { project, task, ...runFields(run) }
    this.runs.set(keyOf(project, task), stored)
    this.store.save(stored)
  }

  /** The runs of the project's tasks by task id, for the page. */
  ofProject(project: string): Record<string, TaskRun> {
    const found: Record<string, TaskRun> = {}
    for (const run of this.runs.values()) if (run.project === project) found[run.task] = runFields(run)
    return found
  }

  /**
   * Once per reader of a project that read run labels before the update: each open task of a reader's first list with
   * one run label and no run yet gets that label as its run. A task with several was launched as its project said, and
   * still is. The labels stay in the tracker. `lists` are the readers' lists so far, `readers` all of the project's: its
   * mark goes once every reader has been moved (BTN-1253), until then a restart moves the moved readers again. Returns
   * the tasks moved.
   */
  importLabels(project: string, lists: ReadonlyMap<string, readonly Pick<Task, 'id' | 'labels' | 'status'>[]>, readers: readonly string[]): string[] {
    if (!this.pending.has(project)) return []
    const done = this.movedReaders.get(project) ?? new Set<string>()
    this.movedReaders.set(project, done)
    const moved: string[] = []
    for (const [reader, tasks] of lists) {
      if (done.has(reader)) continue
      done.add(reader)
      for (const task of tasks) if (this.importLabel(project, task)) moved.push(task.id)
    }
    if (readers.every((reader) => done.has(reader))) {
      this.pending.delete(project)
      this.movedReaders.delete(project)
      this.store.imported(project)
    }
    return moved
  }

  private importLabel(project: string, task: Pick<Task, 'id' | 'labels' | 'status'>): boolean {
    if (!isOpen(task.status) || this.runs.has(keyOf(project, task.id))) return false
    const labels = new Map<string, RunLabel>()
    for (const label of task.labels) {
      const run = runLabelOf(label)
      if (run !== null) labels.set(`${run.provider}|${run.model ?? ''}`, run)
    }
    const [only] = labels.values()
    if (labels.size !== 1 || only === undefined) return false
    this.set(project, task.id, { provider: only.provider, model: only.model, effort: null })
    return true
  }

  /** Drops the project's runs in memory; their rows go with `forgetProjectRows`. */
  forget(project: string): void {
    for (const [key, run] of this.runs) if (run.project === project) this.runs.delete(key)
    this.pending.delete(project)
    this.movedReaders.delete(project)
  }

  /** The project's tasks got new ids (BTN-1074, its tracker switched): each run goes to its task's new id. */
  rename(project: string, names: ReadonlyMap<string, string>): void {
    for (const run of [...this.runs.values()]) {
      const to = run.project === project ? names.get(run.task) : undefined
      if (to === undefined || to === run.task) continue
      this.set(project, run.task, null)
      this.set(project, to, runFields(run))
    }
  }
}
