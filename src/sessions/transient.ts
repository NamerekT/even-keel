/** Provider overload refusals, as opposed to spent allowances, bad keys and invalid requests. */
export function isTransientError(text: string): boolean {
  return /\bat capacity\b|\boverloaded(?:[_ -]?error)?\b|\bserver[_ -]is[_ -]overloaded\b|\bservice[_ -]unavailable\b/i.test(text)
}
