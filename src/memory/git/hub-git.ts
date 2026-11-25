import type { GitAnswer, GitRequest } from '../../link/protocol.js'
import { gitBackend, plainAnswer } from './backend.js'
import { CONFIG_REPOSITORY } from './config-copy.js'

export interface HubMemoryGitDeps {
  /** The machine has a folder of the project in its pool, turned on or not (`project_machines`). */
  placed(project: string, machine: string): Promise<boolean>
  /** The hub's owner bound a folder of the machine to the project's memory (`MemoryFolders`). */
  bound(machine: string, project: string): boolean
  /** The project's bare repository; `null` — none yet. */
  repository(project: string): string | null
  /** A machine pushed into the project's repository: the hub's own copies take it. */
  pushed(project: string): void
  log(line: string): void
  backend?: typeof gitBackend
}

/**
 * The hub's answer to a machine's `/link/git` (BTN-1648, `docs/sessions/memory.md`): `git http-backend` over the
 * project's memory repository, only for a machine with the project in its pool or a folder bound to it; else 403.
 * The global configuration's repository `config` is open to every machine of the network (BTN-1690).
 */
export function hubMemoryGit(deps: HubMemoryGitDeps): (machine: string, project: string, request: GitRequest) => Promise<GitAnswer> {
  const refused = new Set<string>()
  return async (machine, project, request) => {
    const shared = project === CONFIG_REPOSITORY
    if (!shared && !deps.bound(machine, project) && !(await deps.placed(project, machine))) {
      const key = `${machine}\0${project}`
      if (!refused.has(key)) {
        refused.add(key)
        deps.log(`memory: machine ${machine} asked for the memory of ${project}, a project it has no folder of: refused`)
      }
      return plainAnswer(403, 'this machine has no folder of the project')
    }
    const repository = deps.repository(project)
    if (repository === null) return plainAnswer(404, 'the project has no memory repository on the hub yet')
    const answer = await (deps.backend ?? gitBackend)(repository, request, machine)
    if (request.path.endsWith('/git-receive-pack') && answer.status === 200) deps.pushed(project)
    return answer
  }
}
