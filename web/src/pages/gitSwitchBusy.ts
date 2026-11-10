import type { EvenKeelState } from '../../../src/state.js'

const folderKey = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()

/**
 * Whether the project's git mode cannot be switched now (BTN-884): its chain works on a task, or a session of its tasks
 * or in its folder is alive. The service checks the same and has the last word; this greys the button with the reason.
 */
export function gitSwitchBusy(state: Pick<EvenKeelState, 'chain' | 'tasks' | 'sessions' | 'config'>, project: string): boolean {
  if (state.chain.active.some((chain) => chain.project === project && chain.current !== null)) return true
  const tasks = new Set(state.tasks.filter((task) => task.project === project).map((task) => task.id))
  const repo = state.config.projects[project]?.repo
  const folder = repo === undefined ? null : folderKey(repo)
  return state.sessions.some((session) => {
    if (session.lamp === 'finished') return false
    if (tasks.has(session.task)) return true
    const cwd = folderKey(session.cwd)
    return folder !== null && (cwd === folder || cwd.startsWith(`${folder}/`))
  })
}
