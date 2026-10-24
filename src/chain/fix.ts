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

// A release project's carry that git could not merge is resolved by a session without a tracker task too (BTN-369). It
// runs in the project the release merges into, under the release project's stem, so two releases of one project differ.
const CARRY_TAIL = '-CARRY'
const CARRY_EPISODE = /-CARRY(\.\d+)?$/

/** The name the carry of a release project runs under: `EKR-CARRY`. */
export const carryNameOf = (keys: Readonly<Record<string, string>>, from: string): string => `${fixStem(keys, from)}${CARRY_TAIL}`

/** The carry's name or the id of one of its episodes: `EKR-CARRY`, `EKR-CARRY.2`. */
export const isCarryName = (name: string): boolean => CARRY_EPISODE.test(name)

/** The release project whose carry runs under the name, or one of its episodes is named so. */
export const releaseOfCarry = (keys: Readonly<Record<string, string>>, name: string): string | undefined =>
  Object.keys(keys).find((project) => carryNameOf(keys, project) === fixTaskOf(name))

/** The project the carry under the name (or of the episode) runs in: the one its release project (`into`) merges into. */
export function projectOfCarry(keys: Readonly<Record<string, string>>, into: (from: string) => string | undefined, name: string): string | undefined {
  const from = releaseOfCarry(keys, name)
  return from === undefined ? undefined : into(from)
}

/** A session without a tracker task, a fix of main or a carry, by its name or an episode's id. */
export const isOwnName = (name: string): boolean => isFixName(name) || isCarryName(name)

/**
 * Each fix or carry of a project is an episode of its own on the page, `ABC-FIX.<n>` from the first one on; `fix` is
 * its name.
 */
export const fixEpisodeId = (fix: string, number: number): string => `${fix}.${number}`

/** The name a fix or a carry runs under, for the id of any of its episodes; any other id as it is. */
export const fixTaskOf = (id: string): string => (isCarryName(id) ? id.replace(CARRY_EPISODE, CARRY_TAIL) : id.replace(EPISODE, TAIL))

/** The episode a fix or carry session running now belongs to: the open one of its name, otherwise the one it starts. */
export function liveFixId(fix: string, episodes: readonly { id: string; end: unknown }[]): string {
  const own = episodes.filter((episode) => fixTaskOf(episode.id) === fix)
  const last = own.at(-1)
  return last !== undefined && last.end === null ? last.id : fixEpisodeId(fix, own.length + 1)
}
