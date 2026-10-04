import type { ModelAlias, Task } from '../tracker/model.js'

export interface LaunchPlan {
  model: ModelAlias
  prompt: string
  warning: string | null
}

// The model is always passed explicitly: without --model the CLI takes it from settings.json, which an editor may have just changed.
export function launchPlan(
  task: Pick<Task, 'id' | 'models'> | undefined,
  prompt: string,
  fallback: ModelAlias,
  prompts: Partial<Record<ModelAlias, string>>,
): LaunchPlan {
  const models = task?.models ?? []
  const model = models.length === 1 ? models[0]! : fallback
  const warning = models.length > 1 ? `chain: ${task!.id} carries model labels ${models.join(', ')}; launching it on ${fallback}` : null
  const extra = prompts[model]
  return { model, prompt: extra === undefined ? prompt : `${prompt}\n\n${extra}`, warning }
}
