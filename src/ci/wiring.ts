import type { Git } from '../git/types.js'
import { ciSource, projectTargets } from './adapters.js'
import type { CiTarget } from './remote.js'
import { SharedSources } from './shared.js'
import { CiWatch } from './watcher.js'
import { CiWatches } from './watches.js'

interface CiWiring {
  git: Git
  token: (project: string, target: CiTarget) => string | null
  branch: (project: string) => string
  timeoutMs: number
  log: (message: string) => void
  onChange: () => void
}

/** The service's CI watches, sharing API answers for clones of the same repository. */
export function createCiWatches(wiring: CiWiring): CiWatches<CiWatch> {
  const { git, timeoutMs, log, onChange } = wiring
  const sources = new SharedSources((target, token) => ciSource(target, token, timeoutMs))
  const source = (project: string, target: CiTarget) => sources.of(target, wiring.token(project, target))
  return new CiWatches({
    targets: (repo) => projectTargets(git, repo),
    watch: (project, repo, target) => new CiWatch({ target, source: source(project, target), git, repo, main: () => wiring.branch(project), log, onChange }),
    source,
    log,
  })
}
