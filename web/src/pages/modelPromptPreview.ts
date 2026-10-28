import { modelPromptMatches, promptPatternOf } from '../../../src/sessions/model-prompts.js'

export interface ProviderModels {
  provider: string
  models: string[]
  complete: boolean
}

/** Every matching model, grouped by provider; an incomplete catalogue cannot rule out a manually entered id. */
export function previewModels(pattern: string, catalog: readonly ProviderModels[]): ProviderModels[] {
  const parsed = promptPatternOf(pattern)
  if (parsed === null) return []
  return catalog.filter(({ provider }) => modelPromptMatches(parsed.provider, provider, null)).map((entry) => ({
    ...entry, models: entry.models.filter((model) => modelPromptMatches(pattern, entry.provider, model)),
  }))
}
