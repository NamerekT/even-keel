import type { Git } from '../git/types.js'
import type { TrackerProfile } from '../profiles/model.js'
import { ciSource, projectTargets } from './adapters.js'
import type { CiKind, CiView } from './model.js'
import type { CiTarget } from './remote.js'
import { SharedSources } from './shared.js'
import { busyRunner } from './verdict.js'
import { CiWatch } from './watcher.js'
import { CiWatches } from './watches.js'

interface CiWiring {
  git: Git
  token: (project: string, target: CiTarget) => string | null
  branch: (project: string) => string
  /** Whether the project's `ci.kinds` name the CI of `kind`. */
  counted: (project: string, kind: CiKind) => boolean
  timeoutMs: number
  log: (message: string) => void
  onChange: () => void
  /** A project's CI on `target` answers again after an error. */
  recovered?: (project: string, target: CiTarget) => void
  profiles: () => readonly TrackerProfile[]
}

/**
 * The shown CIs of each project for the page; one with a queued run of its push names the run that holds its runner
 * (BTN-828), among every CI the service watches, as the verdict reads it.
 */
export function ciViews(watches: CiWatches<CiWatch>): Record<string, CiView[]> {
  const neighbours = watches.all().map((watch) => watch.view)
  const withBusy = (view: CiView): CiView => {
    if (view.current?.runs.some((each) => each.run.status === 'queued') !== true) return view
    const busy = busyRunner(view, neighbours)
    return busy === null ? view : { ...view, busy }
  }
  return Object.fromEntries([...watches.byProject.keys()].map((project) => [project, watches.shown(project).map((watch) => withBusy(watch.view))]))
}

/** The service's CI watches, sharing API answers for clones of the same repository. */
export function createCiWatches(wiring: CiWiring): CiWatches<CiWatch> {
  const { git, timeoutMs, log, onChange } = wiring
  const sources = new SharedSources((target, token) => ciSource(target, token, timeoutMs))
  const source = (project: string, target: CiTarget) => sources.of(target, wiring.token(project, target))
  return new CiWatches({
    targets: (repo) => projectTargets(git, repo, wiring.profiles()),
    watch: (project, repo, target) =>
      new CiWatch({
        target,
        source: source(project, target),
        git,
        repo,
        main: () => wiring.branch(project),
        counted: () => wiring.counted(project, target.kind),
        log,
        onChange,
        onRecovered: () => wiring.recovered?.(project, target),
      }),
    source,
    log,
  })
}
