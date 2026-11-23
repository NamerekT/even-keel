import { gitCredentials } from '../ci/git-credentials.js'
import type { CredentialsOf, GitCredential } from '../git/credentials.js'
import type { CredentialsAnswer } from '../link/protocol.js'
import { placedIn } from '../machine/assignments.js'
import { isInside, samePath } from '../paths.js'
import type { ServiceContext } from '../service.js'

type HubReads = Pick<ServiceContext, 'db' | 'profiles' | 'configStore'>

/** The tokens of a project's HTTPS remotes (BTN-1541); no project — a new project's clone, on the forges' defaults. */
export function projectGitCredentials(ctx: Pick<HubReads, 'profiles' | 'configStore'>, project: string | undefined, urls: readonly string[]): GitCredential[] {
  const config = ctx.configStore.current
  const scope = project === undefined ? {} : { project, tracker: config.trackers[project] ?? '', chosen: config.settings[project]?.remoteProfiles ?? {} }
  return gitCredentials(urls, ctx.profiles.current(), scope)
}

/** Answers a machine's `/link/credentials`; `cloning` — the hub is cloning the project onto that machine now. */
export type HubGitCredentials = (machine: string, project: string, urls: string[], cloning?: boolean) => Promise<CredentialsAnswer>

/**
 * The hub's answer to a machine's `/link/credentials`: only for a project whose folder the machine has in its pool, on
 * or off (a connect checks the right to push before turning it on), or that the hub is cloning onto it now.
 */
export function hubGitCredentials(ctx: HubReads, log: (line: string) => void): HubGitCredentials {
  return async (machine, project, urls, cloning = false) => {
    if (!cloning && !(await placedIn(ctx.db, project, machine))) {
      log(`link: machine ${machine} asked git credentials of ${project}, a project it has no folder of and is not cloning: refused`)
      return { credentials: [] }
    }
    return { credentials: projectGitCredentials(ctx, project, urls) }
  }
}

/**
 * The credentials of a folder of the hub's projects, read straight from the profiles (its checkout's calls on the
 * hub); a folder of no project gets none.
 */
export function folderGitCredentials(ctx: Pick<HubReads, 'profiles' | 'configStore'>): CredentialsOf {
  return async (folder, urls) => {
    const project = projectOfFolder(ctx.configStore.current.projects, folder)
    return project === undefined ? [] : projectGitCredentials(ctx, project, urls)
  }
}

/** The project whose folder holds `folder` (its checkout, a task's worktree, a slot); `undefined` — none. */
export function projectOfFolder(projects: Readonly<Record<string, string>>, folder: string): string | undefined {
  const entries = Object.entries(projects)
  return (entries.find(([, repo]) => samePath(repo, folder)) ?? entries.find(([, repo]) => isInside(folder, repo)))?.[0]
}
