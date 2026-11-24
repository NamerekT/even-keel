import type { MainCiDeps } from '../chain/mainci.js'
import { shortCommit } from '../ci/verdict.js'
import { landedCommits, mergedCommits } from '../git/merged.js'
import { notice } from '../notice/notice.js'
import type { MachineMainPort } from './port.js'

/** The commits a fix task lists, from the last green commit; without one, the latest of main. */
const COMMITS_SINCE_GREEN = 50
const COMMITS_WITHOUT_GREEN = 20

type MainMachineDeps = Pick<MainCiDeps, 'repo' | 'plain' | 'main' | 'git' | 'commands' | 'reported' | 'settings' | 'prepare' | 'place' | 'runCheck' | 'runAfterGreen' | 'forward'> & {
  /** PR mode: the forge lands the branch, so a merge into the local main is what counts (BTN-1581). */
  pullRequests?: (project: string) => boolean
}

export function mainMachineDeps(deps: MainMachineDeps): MachineMainPort {
  const plain = (project: string) => deps.plain?.(project) === true
  const revision = async (cwd: string, rev: string) => {
    const read = await deps.git(cwd, ['rev-parse', '--verify', '--quiet', rev])
    return read.code === 0 ? read.out.trim() : null
  }

  return {
    head: async (project) => (plain(project) ? null : revision(deps.repo(project), `refs/heads/${deps.main(project)}`)),
    prepare: deps.prepare,
    // A check of other commands than the project's now proves nothing about them.
    reportedTree(project, task) {
      if (plain(project)) return null
      const report = deps.reported(project, task)
      const commands = deps.commands(project)
      const same = report !== undefined && report.commands.length === commands.length && report.commands.every((command, at) => command === commands[at])
      return same ? report.tree : null
    },
    tree: async (project, commit) => (plain(project) ? null : revision(deps.repo(project), `${commit}^{tree}`)),
    async checkMain(project, task) {
      // A check of main due from before the guard was turned off.
      if (!deps.settings(project).guard) return { state: 'skipped', reason: 'the guard of main is off' }
      const path = await deps.place(project, task)
      const branch = deps.main(project)
      const [head, main] = await Promise.all([revision(path, 'HEAD'), revision(deps.repo(project), `refs/heads/${branch}`)])
      if (head === null || head !== main) return { state: 'skipped', reason: `the place of ${task} (${path}) is not on ${branch}` }
      const failure = await deps.runCheck(project, task, path)
      return failure === null ? { state: 'green' } : { state: 'red', failure }
    },
    // Landed, not only merged: in the main of every remote of the checkout (BTN-1581); `local` — merged into its own main.
    merged: async (project, task, local) => {
      if (plain(project)) return []
      if (local === true) return mergedCommits(deps.git, deps.repo(project), task, deps.main(project))
      return landedCommits(deps.git, deps.repo(project), task, deps.main(project), deps.pullRequests?.(project) === true)
    },
    // The commands run only in a checkout on main at the green commit. With `forward` main is first brought up to it by
    // fast-forward (BTN-994): another machine of the pool may have pushed it (BTN-1597).
    async runAfterGreen(project, commit, forward = false) {
      const repo = deps.repo(project)
      const branch = deps.main(project)
      const outcome = forward ? await deps.forward?.(project, commit) : undefined
      const [on, head] = await Promise.all([deps.git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']), revision(repo, 'HEAD')])
      const current = on.code === 0 ? on.out.trim() : null
      if (current !== branch) return { state: 'skipped', reason: notice('afterGreen.offBranch', { branch, on: current }) }
      if (head !== commit) {
        const shown = shortCommit(head ?? 'nothing')
        const stuck = outcome === 'dirty' || outcome === 'merging' || outcome === 'notFastForward'
        return { state: 'skipped', reason: stuck ? notice('afterGreen.notForwarded', { head: shown, why: outcome }) : notice('afterGreen.pastCommit', { head: shown }) }
      }
      const failure = await deps.runAfterGreen(project, repo)
      return failure === null ? { state: 'done' } : { state: 'failed', failure }
    },
    async history(project, commit, candidates) {
      const repo = deps.repo(project)
      // A peer's green commit may be past the red one or not fetched here yet: only those behind it bound the list.
      const greens: string[] = []
      for (const green of candidates) {
        if (green === commit) continue
        if ((await deps.git(repo, ['merge-base', '--is-ancestor', green, commit])).code === 0) greens.push(green)
      }
      const range = greens.length === 0 ? [`-${COMMITS_WITHOUT_GREEN}`, commit] : [`-${COMMITS_SINCE_GREEN}`, commit, ...greens.map((green) => `^${green}`)]
      const log = await deps.git(repo, ['log', '--format=%h %s', ...range])
      const commits = log.code === 0 ? log.out.split(/\r?\n/).filter((line) => line.trim() !== '') : []
      return { commits, greens }
    },
  }
}
