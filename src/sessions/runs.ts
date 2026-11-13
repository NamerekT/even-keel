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
export function taskRunOf(raw: { provider?: unknown; model?: unknown; effort?: unknown }): TaskRun | null {
  for (const field of ['provider', 'model', 'effort'] as const) {
    if (!blank(raw[field]) && typeof raw[field] !== 'string') throw fail('request.required', { field })
  }
  const provider = blank(raw.provider) ? null : (raw.provider as string).trim().toLowerCase()
  const model = blank(raw.model) ? null : (raw.model as string).trim()
  const effort = blank(raw.effort) ? null : (raw.effort as string).trim().toLowerCase()
  if (provider !== null && !isProvider(provider)) throw fail('run.unknownProvider', { provider, known: [...PROVIDERS] })
  if (model !== null && provider === null) throw fail('run.modelWithoutProvider', { model })
  if (effort !== null) {
    const known = provider === null ? [...new Set(Object.values(EFFORTS).flat())] : (EFFORTS[provider] ?? [])
    if (!known.includes(effort)) throw fail('run.unknownEffort', { effort, provider: provider ?? '', known: [...known] })
  }
  return provider === null && effort === null ? null : { provider, model, effort }
}

export const RUN_FIELDS = ['provider', 'model', 'effort'] as const

/** A change of a run: the fields named, `null` to clear one. */
export type RunPatch = Partial<Record<(typeof RUN_FIELDS)[number], string | null>>

/**
 * The run after a change, checked as `taskRunOf` checks it; `null` — nothing is left set. A new provider drops the
 * model the change does not name: a model is its provider's.
 */
export function patchedRun(current: TaskRun | undefined, patch: RunPatch): TaskRun | null {
  const provider = 'provider' in patch ? patch.provider : current?.provider
  const moved = 'provider' in patch && (patch.provider ?? null)?.trim().toLowerCase() !== (current?.provider ?? null)
  const model = 'model' in patch ? patch.model : moved ? null : current?.model
  const effort = 'effort' in patch ? patch.effort : current?.effort
  return taskRunOf({ provider, model, effort })
}

export function sameRun(one: TaskRun | null | undefined, other: TaskRun | null | undefined): boolean {
  return RUN_FIELDS.every((field) => (one?.[field] ?? null) === (other?.[field] ?? null))
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
 * `docs/storage.md`). `pending` are the projects that read run labels before the update: the first list of a project's
 * tasks moves the run label of each open one into a run, once (`importLabels`).
 */
export class TaskRuns {
  private readonly runs = new Map<string, StoredRun>()
  private readonly pending: Set<string>

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
    return run === undefined ? undefined : { provider: run.provider, model: run.model, effort: run.effort }
  }

  /** `null` — the task runs as its project says again. */
  set(project: string, task: string, run: TaskRun | null): void {
    if (run === null) {
      if (this.runs.delete(keyOf(project, task))) this.store.drop(project, task)
      return
    }
    const stored = { project, task, provider: run.provider, model: run.model, effort: run.effort }
    this.runs.set(keyOf(project, task), stored)
    this.store.save(stored)
  }

  /** The runs of the project's tasks by task id, for the page. */
  ofProject(project: string): Record<string, TaskRun> {
    const found: Record<string, TaskRun> = {}
    for (const run of this.runs.values()) if (run.project === project) found[run.task] = { provider: run.provider, model: run.model, effort: run.effort }
    return found
  }

  /**
   * Once per project that read run labels before the update: each open task with one run label and no run yet gets
   * that label as its run. A task with several was launched as its project said, and still is. The labels stay in the
   * tracker. Returns the tasks moved.
   */
  importLabels(project: string, tasks: readonly Pick<Task, 'id' | 'labels' | 'status'>[]): string[] {
    if (!this.pending.has(project)) return []
    const moved: string[] = []
    for (const task of tasks) {
      if (!isOpen(task.status) || this.runs.has(keyOf(project, task.id))) continue
      const labels = new Map<string, RunLabel>()
      for (const label of task.labels) {
        const run = runLabelOf(label)
        if (run !== null) labels.set(`${run.provider}|${run.model ?? ''}`, run)
      }
      const [only] = labels.values()
      if (labels.size !== 1 || only === undefined) continue
      this.set(project, task.id, { provider: only.provider, model: only.model, effort: null })
      moved.push(task.id)
    }
    this.pending.delete(project)
    this.store.imported(project)
    return moved
  }

  /** Drops the project's runs in memory; their rows go with `forgetProjectRows`. */
  forget(project: string): void {
    for (const [key, run] of this.runs) if (run.project === project) this.runs.delete(key)
    this.pending.delete(project)
  }
}
