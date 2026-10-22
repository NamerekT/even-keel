import { readHulyCredentials, type HulyCredentials } from '../../src/huly/credentials.js'
import type { HulyProfiles } from '../../src/stats/tally.js'

/** The credentials that reach a task's Huly project; `undefined` — none. */
export type HulyOf = (task: string) => HulyCredentials | undefined

/**
 * A task takes the Huly profile its launch was read through (`launched`, task → profile id, BTN-66), else the profile of
 * its project (the key before the last dash), else the default Huly profile (BTN-200); a task of another tracker's
 * project or feed takes none.
 */
export function hulyOfProfiles(profiles: HulyProfiles, launched: ReadonlyMap<string, string> = new Map()): HulyOf {
  const elsewhere = new Set(profiles.elsewhere)
  return (task) => {
    const own = profiles.byId?.[launched.get(task) ?? '']
    const prefix = task.slice(0, task.lastIndexOf('-'))
    if (own === undefined && elsewhere.has(prefix) && profiles.projects[prefix] === undefined) return undefined
    const values = own ?? profiles.projects[prefix] ?? profiles.fallback
    if (values === null) return undefined
    try {
      return readHulyCredentials(values)
    } catch {
      return undefined
    }
  }
}

/** The items by the credentials that reach their task, in the order first met; those none reaches are left out. */
export function byCredentials<T>(items: readonly T[], taskOf: (item: T) => string, hulyOf: HulyOf): { credentials: HulyCredentials; items: T[] }[] {
  const groups = new Map<string, { credentials: HulyCredentials; items: T[] }>()
  for (const item of items) {
    const credentials = hulyOf(taskOf(item))
    if (credentials === undefined) continue
    const key = JSON.stringify(credentials)
    const group = groups.get(key) ?? { credentials, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
}
