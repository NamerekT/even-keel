// A red main is fixed by a session without a tracker task (BTN-115). It runs under this name, one per project:
// the session, its worktree and its branch are found by it the way a task's are by the task id.
const TAIL = '-FIX'
const EPISODE = /-FIX(\.\d+)?$/

export const fixName = (project: string): string => `${project}${TAIL}`

/** The fix's name or the id of one of its episodes (BTN-153): `ABC-FIX`, `ABC-FIX.3`. */
export const isFixName = (name: string): boolean => EPISODE.test(name)

/** Each fix of a project is an episode of its own on the page, `ABC-FIX.<n>` from the first one on. */
export const fixEpisodeId = (project: string, number: number): string => `${fixName(project)}.${number}`

/** The name the fix runs under, for the id of any of its episodes. */
export const fixTaskOf = (id: string): string => id.replace(EPISODE, TAIL)

/** The episode a fix session running now belongs to: the open one, otherwise the one it starts. */
export function liveFixId(project: string, episodes: readonly { id: string; end: unknown }[]): string {
  const last = episodes.at(-1)
  return last !== undefined && last.end === null ? last.id : fixEpisodeId(project, episodes.length + 1)
}
