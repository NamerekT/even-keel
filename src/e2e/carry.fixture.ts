import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Harness, RELEASE_ID } from './service.fixture.js'

/** A release project carried forward, for `carry.test.ts` and `carry-agent.test.ts`. */

export const CARRY = 'REL-CARRY'
export const FORWARD_REF = `refs/even-keel/forward/${RELEASE_ID}`
/** One forward tick of the service and a step of slack. */
export const TICK = 61_000

/** The views and histories a carry scenario reads, and the histories it prepares, over the scenario's `run`. */
export function carryOf(bench: () => Harness) {
  const view = () => bench().service.forwards.view()[RELEASE_ID]
  const launches = (task: string) => bench().agent.calls.filter((call) => call.kind === 'launch' && call.task === task)
  const carry = () => bench().service.dispatcher.state.ci[RELEASE_ID]?.carry
  const subjects = (repo: string, branch = 'main') => bench().gitIn(repo, 'log', '--format=%s', branch).split('\n')
  const commitIn = (repo: string, file: string, text: string, subject: string) => {
    writeFileSync(join(repo, file), text)
    bench().gitIn(repo, 'add', file)
    bench().gitIn(repo, 'commit', '-q', '-m', subject)
  }
  /** A fix of the release branch. */
  const fixed = () => commitIn(bench().releaseRepo, 'fix.txt', 'fixed\n', 'Release fix')
  /** A fix of the release branch and a commit of `main` of its own: the carry is a merge commit. */
  const diverged = () => {
    fixed()
    commitIn(bench().repo, 'own.txt', 'own\n', 'Main change')
  }
  /** A fix of the release branch and a change of `main` to the same line: the carry conflicts in `README.md`. */
  const conflicting = () => {
    commitIn(bench().releaseRepo, 'README.md', '# Example (release)\n', 'Release fix')
    commitIn(bench().repo, 'README.md', '# Example (main)\n', 'Main change')
  }
  /** The checkout is on its branch with nothing staged, changed or half-merged. */
  const clean = (repo: string) => bench().gitIn(repo, 'status', '--porcelain', '--untracked-files=no') === '' && !existsSync(join(repo, '.git', 'MERGE_HEAD'))
  return { view, launches, carry, subjects, commitIn, fixed, diverged, conflicting, clean }
}
