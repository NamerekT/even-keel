import { readHulyCredentials, type HulyCredentials } from '../../src/huly/credentials.js'
import type { HulyProfiles } from '../../src/stats/tally.js'

/** The credentials that reach a task's Huly project; `undefined` — none. */
export type HulyOf = (task: string) => HulyCredentials | undefined

/** A task takes the profile of its project (the key before the last dash), else the default Huly profile (BTN-200). */
export function hulyOfProfiles(profiles: HulyProfiles): HulyOf {
  return (task) => {
    const values = profiles.projects[task.slice(0, task.lastIndexOf('-'))] ?? profiles.fallback
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
