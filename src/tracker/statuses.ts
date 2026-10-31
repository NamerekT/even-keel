import type { ProfileSet } from '../profiles/model.js'
import type { TaskStatus } from './model.js'
import type { TrackerAdapter } from './source.js'

const TIMEOUT_MS = 15_000

/**
 * The statuses a tracker profile's tasks may be in (BTN-554), read on a connection of its own: a profile just added has
 * no tracker running on it yet. `undefined` — no such profile, its kind moves no statuses, or the tracker named none.
 */
export async function profileStatusesOf(adapters: Readonly<Record<string, TrackerAdapter>>, set: ProfileSet, id: string): Promise<TaskStatus[] | undefined> {
  const profile = set.profiles.find((each) => each.id === id)
  const adapter = profile === undefined ? undefined : adapters[profile.kind]
  if (profile === undefined || adapter?.moves === undefined) return undefined
  const setup = adapter.setup(profile.values, {})
  if (setup === undefined) return undefined
  const source = await setup.connect(TIMEOUT_MS)
  try {
    const statuses = (await source.statuses?.()) ?? []
    return statuses.length === 0 ? undefined : statuses
  } finally {
    await source.close()
  }
}
