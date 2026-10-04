import type { ModelAlias, Task } from '../tracker/model.js'

export interface LaunchPlan {
  model: ModelAlias | null
  prompt: string
  warning: string | null
}

export function launchPlan(
  task: Pick<Task, 'id' | 'models'> | undefined,
  prompt: string,
  prompts: Partial<Record<ModelAlias, string>>,
): LaunchPlan {
  const models = task?.models ?? []
  if (models.length > 1) {
    const warning = `chain: ${task!.id} carries model labels ${models.join(', ')}; launching it on the default model`
    return { model: null, prompt, warning }
  }
  const model = models[0] ?? null
  const extra = model === null ? undefined : prompts[model]
  return { model, prompt: extra === undefined ? prompt : `${prompt}\n\n${extra}`, warning: null }
}
