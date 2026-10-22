// A red main is fixed by a session without a tracker task (BTN-115). It runs under this name, one per project:
// the session, its worktree and its branch are found by it the way a task's are by the task id.
const TAIL = '-FIX'
const EPISODE = /-FIX(\.\d+)?$/

export const fixName = (stem: string): string => `${stem}${TAIL}`

/**
 * What a project's fix name starts with: its key. Projects may share a key (BTN-271): the first one of a key in the
 * config keeps it, every other adds the first four characters of its id, `ABC_1F3A`. `keys` is the key of each project
 * by id, in the order of the config.
 */
export function fixStem(keys: Readonly<Record<string, string>>, project: string): string {
  const key = keys[project]
  if (key === undefined) return project
  const first = Object.keys(keys).find((other) => keys[other] === key)
  return first === project ? key : `${key}_${shortId(project)}`
}

/** The first four letters and digits of a project's id, upper case: what tells apart two projects of one key. */
export const shortId = (project: string): string => project.replace(/[^0-9a-z]/gi, '').slice(0, 4).toUpperCase()

/** The name the project's fix runs under: `ABC-FIX`. */
export const fixNameOf = (keys: Readonly<Record<string, string>>, project: string): string => fixName(fixStem(keys, project))

/** The project whose fix runs under the name, or one of its episodes is named so. */
export const projectOfFix = (keys: Readonly<Record<string, string>>, name: string): string | undefined =>
  Object.keys(keys).find((project) => fixNameOf(keys, project) === fixTaskOf(name))

/** The fix's name or the id of one of its episodes (BTN-153): `ABC-FIX`, `ABC-FIX.3`. */
export const isFixName = (name: string): boolean => EPISODE.test(name)

/** Each fix of a project is an episode of its own on the page, `ABC-FIX.<n>` from the first one on; `fix` is its name. */
export const fixEpisodeId = (fix: string, number: number): string => `${fix}.${number}`

/** The name the fix runs under, for the id of any of its episodes. */
export const fixTaskOf = (id: string): string => id.replace(EPISODE, TAIL)

/** The episode a fix session running now belongs to: the open one, otherwise the one it starts. */
export function liveFixId(fix: string, episodes: readonly { id: string; end: unknown }[]): string {
  const last = episodes.at(-1)
  return last !== undefined && last.end === null ? last.id : fixEpisodeId(fix, episodes.length + 1)
}
