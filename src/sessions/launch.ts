import type { ModelAlias, Task } from '../tracker/model.js'

// Always passed explicitly: without --model the CLI takes the model from settings.json, which an editor may have just changed.
const DEFAULT_MODEL: ModelAlias = 'opus'

export interface LaunchPlan {
  model: ModelAlias
  prompt: string
  warning: string | null
}

export function launchPlan(
  task: Pick<Task, 'id' | 'models'> | undefined,
  prompt: string,
  prompts: Partial<Record<ModelAlias, string>>,
): LaunchPlan {
  const models = task?.models ?? []
  const model = models.length === 1 ? models[0]! : DEFAULT_MODEL
  const warning =
    models.length > 1 ? `chain: ${task!.id} carries model labels ${models.join(', ')}; launching it on ${DEFAULT_MODEL}` : null
  const extra = prompts[model]
  return { model, prompt: extra === undefined ? prompt : `${prompt}\n\n${extra}`, warning }
}
