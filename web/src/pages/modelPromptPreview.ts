import { modelPromptMatches, promptPatternOf } from '../../../src/sessions/model-prompts.js'

export interface ProviderModels {
  provider: string
  models: string[]
  complete: boolean
}

/** A provider's matches; `all` when the pattern takes every model of it, so the page counts them instead of listing. */
export interface ProviderMatches extends ProviderModels {
  all: boolean
}

/** Every matching model, grouped by provider; an incomplete catalogue cannot rule out a manually entered id. */
export function previewModels(pattern: string, catalog: readonly ProviderModels[]): ProviderMatches[] {
  const parsed = promptPatternOf(pattern)
  if (parsed === null) return []
  const all = parsed.model === null || /^\*+$/.test(parsed.model)
  return catalog.filter(({ provider }) => modelPromptMatches(parsed.provider, provider, null)).map((entry) => ({
    ...entry, models: entry.models.filter((model) => modelPromptMatches(pattern, entry.provider, model)), all,
  }))
}
