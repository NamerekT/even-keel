/**
 * Renames the projects of a stored chain state — `active[].project`, `queue` and the keys of the per-project records —
 * leaving the rest as it is. The files keep a project's id, the running service its key; this is the one place that
 * knows where a project is named in the file.
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

const PER_PROJECT = ['orders', 'skipped', 'leftovers', 'released', 'ci'] as const

/** A rename by a map that passes a name not in it through: an id of a removed project stays as it is. */
export function byMap(map: Record<string, string>): (project: string) => string {
  return (project) => map[project] ?? project
}

/** The keys of `before` renamed to the keys `after` gives the same ids; any other name passes through. */
export function rekeyed(before: Record<string, string>, after: Record<string, string>): (project: string) => string {
  const keyOf = inverted(after)
  return (project) => {
    const id = before[project]
    return id === undefined ? project : (keyOf[id] ?? project)
  }
}

/** The map turned around: key by id from id by key. */
export function inverted(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
