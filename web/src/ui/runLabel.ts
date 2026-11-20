import { taskRunText, type TaskRun } from '../../../src/sessions/runs.js'

/** The model without its route: `openrouter/minimax/minimax-m3.1-flash` → `minimax-m3.1-flash`. */
export function modelName(model: string): string {
  return model.slice(model.lastIndexOf('/') + 1)
}

const EFFORT_BARS: ReadonlyMap<string, number> = new Map([['minimal', 1], ['low', 1], ['medium', 2], ['high', 3], ['xhigh', 4], ['max', 5]])

/** How many of the effort scale's five bars an effort fills; `null` — no scale: no effort, `none` or a word not known. */
export function effortLevel(effort: string | null): number | null {
  return effort === null ? null : EFFORT_BARS.get(effort) ?? null
}

/** The parts of a run as its tag shows them: the provider capitalised as `taskRunText` writes it, the model short. */
export function runView(run: TaskRun): { provider: string | null; model: string | null; effort: string | null } {
  const provider = run.provider === null ? null : taskRunText({ provider: run.provider, model: null, effort: null })
  return { provider, model: run.model === null ? null : modelName(run.model), effort: run.effort }
}
