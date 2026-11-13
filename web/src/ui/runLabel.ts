import { taskRunText, type TaskRun } from '../../../src/sessions/runs.js'

/** The model without its route: `openrouter/minimax/minimax-m3.1-flash` → `minimax-m3.1-flash`. */
export function modelName(model: string): string {
  return model.slice(model.lastIndexOf('/') + 1)
}

/** The parts of a run as its tag shows them: the provider capitalised as `taskRunText` writes it, the model short. */
export function runView(run: TaskRun): { provider: string | null; model: string | null; effort: string | null } {
  const provider = run.provider === null ? null : taskRunText({ provider: run.provider, model: null, effort: null })
  return { provider, model: run.model === null ? null : modelName(run.model), effort: run.effort }
}
