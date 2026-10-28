/** A run-label-shaped pattern: only `*` is special; a bare provider also covers the CLI's unknown default model. */
export function promptPatternOf(text: string): { provider: string; model: string | null } | null {
  const parts = text.split('|').map((part) => part.trim())
  if (parts.length > 2 || parts.some((part) => part === '')) return null
  return { provider: parts[0]!, model: parts[1] ?? null }
}

function matches(pattern: string, value: string): boolean {
  const escaped = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${escaped}$`, 'is').test(value)
}

/** Shared by launch planning and the page's catalogue preview. Unknown models match provider-only patterns. */
export function modelPromptMatches(pattern: string, provider: string, model: string | null): boolean {
  const parsed = promptPatternOf(pattern)
  return parsed !== null && matches(parsed.provider, provider) && (parsed.model === null || (model !== null && matches(parsed.model, model)))
}
