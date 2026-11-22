import type { TaskSource } from '../../src/chain/launches.js'
import type { HulyProfiles } from '../../src/stats/tally.js'
import type { BuiltinTask } from './builtin-tasks.js'
import { hulyOfProfiles, type HulyOf } from './huly-profiles.js'

export interface TaskHomes {
  /** The launch log's homes of the tasks, those the built-in tracker holds without the log's profile and link. */
  sources: TaskSource[]
  /** The tasks the built-in tracker holds, each with the link of its card; `null` — no card to open. */
  owned: Map<string, string | null>
  /** As `hulyOfProfiles`, a task the built-in tracker holds reaching none. */
  hulyOf: HulyOf
}

/**
 * Where each task lives, by the task, not by its project (BTN-1497): one the built-in tracker holds is its own — read
 * whole there (`builtin`), or an old id a switch off it left behind (`leftovers`) whose prefix no project or feed gives
 * now — and goes to no other tracker; any other task is where its launch read it (BTN-66), a feed of a built-in project
 * too.
 */
export function taskHomes(sources: readonly TaskSource[], builtin: readonly BuiltinTask[], leftovers: readonly string[], huly: HulyProfiles): TaskHomes {
  const owned = new Map<string, string | null>(builtin.map((task) => [task.task, `/p/${encodeURIComponent(task.project)}?task=${encodeURIComponent(task.task)}`]))
  // A service from before BTN-1497 sends no list: its Huly projects and the others are what it has.
  const taken = new Set(huly.prefixes ?? [...Object.keys(huly.projects), ...(huly.elsewhere ?? [])])
  for (const task of leftovers) if (!owned.has(task) && !taken.has(task.slice(0, task.lastIndexOf('-')))) owned.set(task, null)
  const homes = sources.map((source) => (owned.has(source.task) ? { ...source, profile: null, url: null } : source))
  const launched = new Map(homes.flatMap((home) => (home.profile === null ? [] : [[home.task, home.profile] as const])))
  const reach = hulyOfProfiles(huly, launched)
  return { sources: homes, owned, hulyOf: (task) => (owned.has(task) ? undefined : reach(task)) }
}
