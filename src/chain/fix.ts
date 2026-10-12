// A red main is fixed by a session without a tracker task (BTN-115). It runs under this name, one per project:
// the session, its worktree and its branch are found by it the way a task's are by the task id.
const TAIL = '-FIX'

export const fixName = (project: string): string => `${project}${TAIL}`

export const isFixName = (name: string): boolean => name.endsWith(TAIL)
