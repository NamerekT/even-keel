import { taskRunText, type TaskRun } from '../../../src/sessions/runs.js'
import { shortModel } from './modelLabel.js'

const EFFORT_BARS: ReadonlyMap<string, number> = new Map([['minimal', 1], ['low', 1], ['medium', 2], ['high', 3], ['xhigh', 4], ['max', 5]])

/** How many of the effort scale's five bars an effort fills; `null` — no scale: no effort, `none` or a word not known. */
export function effortLevel(effort: string | null): number | null {
  return effort === null ? null : EFFORT_BARS.get(effort) ?? null
}

/** The parts of a run as its tag shows them: the provider capitalised as `taskRunText` writes it, the model's short name (`shortModel`). */
export function runView(run: TaskRun): { provider: string | null; model: string | null; effort: string | null } {
  const provider = run.provider === null ? null : taskRunText({ provider: run.provider, model: null, effort: null })
  return { provider, model: run.model === null ? null : shortModel(run.model).name, effort: run.effort }
}
