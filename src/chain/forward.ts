import type { Git } from '../git/types.js'
import { englishOf, fail, notice, type Notice } from '../notice/notice.js'
import type { ForwardView } from '../state.js'
import type { ActiveChain } from './model.js'

/** A release project and the project whose branch its own one merges into (`mergeInto`). */
export interface ForwardPair {
  from: string
  into: string
}

export interface ForwardDeps {
  pairs: () => ForwardPair[]
  /** Whether the two projects' checkouts are of one repository (`sameRepository`); `undefined` — not read yet. */
  sameRepository: (from: string, into: string) => boolean | undefined
  /** The project's main checkout. */
  repo: (project: string) => string
  /** The project's main branch. */
  branch: (project: string) => string
  /** What the merge commit names the project by (`projectLabel`): the service names it by id. */
  label: (project: string) => string
  /** Whether nothing of the project's chain may merge into its branch now (`chainQuiet`). */
  quiet: (project: string) => boolean
  git: Git
  /** Pushes the project's branch the way the cleanup after Done does (`syncMain`). */
  sync: (project: string) => Promise<Notice | null>
  now: () => Date
  changed: () => void
  log: (message: string) => void
  /** The session that resolves the release project's carry or is about to (BTN-369); `null` — none. */
  carrying: (from: string) => string | null
  /** Asks for that session after the current task of the project the release branch merges into. */
  resolve: (from: string, ask: CarryAsk) => Promise<void>
}

/** What the carry session is told: the release commit to merge and how git failed it. */
export interface CarryAsk {
  into: string
  ref: string
  commit: string
  commits: number
  files: string[]
  output: string
}

/**
 * Whether the chain is quiet enough for the release branch to go into its project's branch: stopped, empty, or paused
 * with its session not working, and neither cleaning up after a task nor waiting on a push of main.
 */
export function chainQuiet(chain: ActiveChain | undefined, busy: (task: string) => boolean): boolean {
  if (chain === undefined) return true
  if (chain.closing !== undefined || chain.ciWait !== undefined) return false
  if (chain.current === null) return true
  return chain.paused && !busy(chain.current.task)
}

/**
 * Carries the branch of each release project into the branch of the project it merges into (BTN-172), in that
 * project's main checkout: by `merge --no-edit` once its chain is quiet, or at once on "Carry now". A failed merge
 * (a conflict, or git refusing with no conflicted file, BTN-314) is aborted, so the checkout stays clean and the chain goes on, and holds the carry until "Carry now", an agent's session or until the branch
 * has the commits by a merge by hand. The hold lives in memory: after a restart the carry is tried once more.
 * A held conflict may be resolved by an agent (BTN-369); while its session is asked for, nothing is merged here.
 */
export class ForwardMerger {
  private readonly views = new Map<string, ForwardView>()
  private work: Promise<void> = Promise.resolve()

  constructor(private readonly deps: ForwardDeps) {}

  view(): Record<string, ForwardView> {
    return Object.fromEntries(
      [...this.views].map(([from, view]) => {
        const agent = this.deps.carrying(from)
        return [from, agent === null ? view : { ...view, agent }]
      }),
    )
  }

  tick(): Promise<void> {
    return this.queue(async () => {
      const pairs = this.deps.pairs()
      for (const from of [...this.views.keys()]) if (!pairs.some((pair) => pair.from === from)) this.views.delete(from)
      for (const pair of pairs) await this.step(pair, false)
    })
  }

  /** "Carry now": no wait for the chain, and a held carry is tried again. */
  carry(from: string): Promise<void> {
    const pair = this.deps.pairs().find((each) => each.from === from)
    if (pair === undefined) return Promise.reject(fail('forward.notRelease', { project: from }))
    const agent = this.deps.carrying(from)
    if (agent !== null) return Promise.reject(fail('forward.agent', { from, task: agent }))
    return this.queue(() => this.step(pair, true))
  }

  /** "Resolve with the agent": only a held conflict, told with the release commit it is to bring in. */
  resolve(from: string): Promise<void> {
    return this.queue(async () => {
      const view = this.views.get(from)
      const hold = view?.held === true ? view.hold : null
      if (view === undefined || hold?.code !== 'forward.conflict' || view.behind === null) throw fail('forward.noConflict', { from })
      const ref = `refs/even-keel/forward/${from}`
      const read = await this.deps.git(this.deps.repo(view.into), ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
      const commit = read.out.trim()
      if (read.code !== 0 || commit === '') throw fail('forward.fetch', { from }, { detail: read.out })
      const files = (hold.params as { files: string[] }).files
      await this.deps.resolve(from, { into: view.into, ref, commit, commits: view.behind, files, output: hold.detail ?? '' })
      this.deps.changed()
    })
  }

  private queue(run: () => Promise<void>): Promise<void> {
    const next = this.work.then(run)
    this.work = next.catch((error) => this.deps.log(`forward: ${error instanceof Error ? error.message : String(error)}`))
    return next
  }

  private async step({ from, into }: ForwardPair, now: boolean): Promise<void> {
    const before = this.views.get(from)
    const view: ForwardView = { into, behind: before?.behind ?? null, hold: before?.hold ?? null, held: before?.held ?? false }
    if (before?.last !== undefined) view.last = before.last
    await this.carryInto(view, from, now)
    if (JSON.stringify(view) !== JSON.stringify(before)) {
      this.views.set(from, view)
      this.deps.changed()
    }
  }

  private async carryInto(view: ForwardView, from: string, now: boolean): Promise<void> {
    const { git } = this.deps
    const into = view.into
    const repo = this.deps.repo(into)
    const branch = this.deps.branch(into)
    const same = this.deps.sameRepository(from, into)
    if (same === undefined) return
    if (!same) return wait(view, notice('forward.foreign', { from, into }))
    const ref = `refs/even-keel/forward/${from}`
    const fetched = await git(repo, ['fetch', '--quiet', this.deps.repo(from), `+refs/heads/${this.deps.branch(from)}:${ref}`])
    if (fetched.code !== 0) return wait(view, notice('forward.fetch', { from }, { detail: fetched.out }))
    const counted = await git(repo, ['rev-list', '--count', `refs/heads/${branch}..${ref}`])
    const behind = Number.parseInt(counted.out.trim(), 10)
    if (counted.code !== 0 || !Number.isInteger(behind)) return wait(view, notice('forward.fetch', { from }, { detail: counted.out }))
    view.behind = behind
    if (behind === 0) {
      Object.assign(view, { hold: null, held: false })
      return
    }
    if ((view.held && !now) || this.deps.carrying(from) !== null) return
    if (!now && !this.deps.quiet(into)) return wait(view, notice('forward.busy', { into }))

    const current = (await git(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).out.trim()
    if (current !== branch) return wait(view, notice('forward.notOnBranch', { repo, branch, current }))
    const status = await git(repo, ['status', '--porcelain', '--untracked-files=no'])
    if (status.code !== 0 || status.out.trim() !== '') return wait(view, notice('forward.dirty', { repo }, { detail: status.out }))

    const merged = await git(repo, ['merge', '--no-edit', '-m', `Merge branch '${this.deps.branch(from)}' of ${this.deps.label(from)} into ${branch}`, ref])
    if (merged.code !== 0) {
      const files = (await git(repo, ['diff', '--name-only', '--diff-filter=U'])).out.split(/\r?\n/).filter((line) => line.trim() !== '')
      await git(repo, ['merge', '--abort'])
      const hold =
        files.length > 0 ? notice('forward.conflict', { from, into, files }, { detail: merged.out }) : notice('forward.failed', { from, into }, { detail: merged.out })
      this.deps.log(files.length > 0 ? englishOf(hold) : `${englishOf(hold)}: ${merged.out.trim()}`)
      Object.assign(view, { hold, held: true })
      return
    }
    const push = await this.deps.sync(into)
    this.deps.log(`forward: ${from} carried ${behind} commit(s) into ${branch} of ${into}${push === null ? '' : `; the push failed: ${englishOf(push)}`}`)
    Object.assign(view, { behind: 0, hold: null, held: false, last: { at: this.deps.now().toISOString(), commits: behind, push } })
  }
}

/** A held carry stays held: the conflict is still there. */
function wait(view: ForwardView, hold: Notice): void {
  view.hold = hold
}
