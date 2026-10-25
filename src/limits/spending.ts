/** Anthropic's organization cap; the workspace wording is accepted defensively until seen live. */
export function isSpendingLimit(text: string): boolean {
  return /reached your specified (?:workspace )?API usage limits\b/i.test(text)
}

/** An explicit UTC reset, with invalid dates and dates preceding the refusal rejected. */
export function spendingReset(text: string, at: string): string | null {
  const match = /regain access on (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}) UTC\b/i.exec(text)
  if (match === null) return null
  const iso = `${match[1]}T${match[2]}:00.000Z`
  const time = Date.parse(iso)
  if (!Number.isFinite(time) || time <= Date.parse(at) || !Number.isFinite(Date.parse(at))) return null
  return new Date(time).toISOString() === iso ? iso : null
}
