import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import type { ModelAlias, Task } from '../tracker/model.js'

export interface LaunchPlan {
  /** The agent the session runs on: the project's, or Codex for a task with the `Codex` label. */
  agent: string
  model: ModelAlias
  prompt: string
  warning: string | null
}

/** The agent a session of the task starts on: Codex for a task with the `Codex` label, else the project's. */
export function agentOfTask(task: Pick<Task, 'labels'> | undefined, projectAgent: string): string {
  return task?.labels.some((label) => label.trim().toLowerCase() === CODEX) ? CODEX : projectAgent
}

// The model is always passed explicitly: without --model the CLI takes it from settings.json, which an editor may have just changed.
// The model labels and their prompts are Claude's: a Codex session gets its model from the project's `codexModel`.
export function launchPlan(
  task: Pick<Task, 'id' | 'models' | 'labels'> | undefined,
  prompt: string,
  fallback: ModelAlias,
  prompts: Partial<Record<ModelAlias, string>>,
  projectAgent: string = CLAUDE,
): LaunchPlan {
  const agent = agentOfTask(task, projectAgent)
  if (agent !== CLAUDE) return { agent, model: fallback, prompt, warning: null }
  const models = task?.models ?? []
  const model = models.length === 1 ? models[0]! : fallback
  const warning = models.length > 1 ? `chain: ${task!.id} carries model labels ${models.join(', ')}; launching it on ${fallback}` : null
  const extra = prompts[model]
  return { agent, model, prompt: extra === undefined ? prompt : `${prompt}\n\n${extra}`, warning }
}
