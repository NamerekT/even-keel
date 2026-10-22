/**
 * Renames the projects of a stored chain state — `active[].project`, `queue` and the keys of the per-project records —
 * leaving the rest as it is: the migration of the v0.1 chain file from keys to ids is the one place that needs it.
 */
export function renameChainProjects(raw: Record<string, unknown>, rename: (project: string) => string): Record<string, unknown> {
  const result: Record<string, unknown> = { ...raw }
  if (Array.isArray(raw.active)) result.active = raw.active.map((chain) => (isRecord(chain) && typeof chain.project === 'string' ? { ...chain, project: rename(chain.project) } : chain))
  else if (isRecord(raw.active) && typeof raw.active.project === 'string') result.active = { ...raw.active, project: rename(raw.active.project) }
  if (Array.isArray(raw.queue)) result.queue = raw.queue.map((project) => (typeof project === 'string' ? rename(project) : project))
  for (const field of PER_PROJECT) {
    const records = raw[field]
    if (isRecord(records)) result[field] = Object.fromEntries(Object.entries(records).map(([project, value]) => [rename(project), value]))
  }
  return result
}

const PER_PROJECT = ['orders', 'skipped', 'leftovers', 'released', 'shelved', 'ci', 'reviews'] as const

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
