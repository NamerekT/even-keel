import { englishOf, notice, noticeOf, type Notice } from '../notice/notice.js'
import { eventKey, outcomeOf } from '../review/events.js'
import { feedbackText, withFeedback } from '../review/feedback.js'
import type { PullRequest, ReviewCheck } from '../review/model.js'
import type { Handovers } from './handover.js'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps, PullCleanup, ReviewDeps, ReviewView } from './model.js'
import { PROMPTS } from './prompts.js'
import { WARM_CACHE_MS, type HandoffSession } from './relay.js'

/** What PR mode needs of the dispatcher that runs it. */
export interface ReviewHost {
  /** Pauses the chain on its current task, which stays current: the chat answers its session, Skip and New session act on it. */
  hold(chain: ActiveChain, error: Notice): void
  /** Sets the current task aside without touching its session. */
  letGo(chain: ActiveChain): void
  /** Remembers a task the chain no longer leads, for the cleanup once it is done. */
  release(project: string, task: string): void
  /** The project's tasks go through the chain's filter again: a task with a pull request leaves the chain or comes back. */
  refilter(project: string): void
  /** Whether the task's session works on, which holds its cleanup. */
  working(task: string): boolean
  /** Cleans up after a task whose pull request was closed unmerged and keeps the warnings. */
  dropUnmerged(project: string, task: string, pull: PullCleanup): Promise<void>
}

interface Polled {
  project: string
  pull: PullRequest
  check: ReviewCheck
}

// PR mode (BTN-205): the session of a task does not merge, it ends its turn with `PULL REQUEST: <path>`. Even Keel
// pushes the branch, opens the pull request and takes the task out of the chain until the pull request is merged —
// the task is then done — or closed, or gets feedback, which goes back to the task's session while it is not mid-turn.
export class Reviews {
  /**
   * The `lastReplyAt` of each task's mark that did not open a pull request: neither Resume nor a restart of the chain
   * tries it again, only a new turn of the session does. A service restart forgets it and tries the mark once more.
   */
  private readonly refused = new Map<string, string | null>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: DispatcherDeps,
    private readonly handovers: Handovers,
    private readonly host: ReviewHost,
  ) {}

  private get review(): ReviewDeps | undefined {
    return this.deps.reviews
  }

  recordOf(project: string, task: string): PullRequest | undefined {
    return this.state.reviews[project]?.find((pull) => pull.task === task)
  }

  /** Whether the task waits on its pull request out of the chain: open without feedback, or closed and not cleaned up after. */
  holds(project: string, task: string): boolean {
    const pull = this.recordOf(project, task)
    return pull !== undefined && (pull.closed !== undefined || pull.feedback === undefined)
  }

  /** The feedback that waits for the task's session, while the pull request is open. */
  feedbackOf(project: string, task: string): string | undefined {
    const pull = this.recordOf(project, task)
    return pull?.closed === undefined ? pull?.feedback : undefined
  }

  /** The first task of `listed` whose feedback waits: the chain takes it before the next task of its order. */
  next(project: string, listed: string[]): string | undefined {
    return listed.find((task) => this.feedbackOf(project, task) !== undefined)
  }

  views(project: string): ReviewView[] {
    return (this.state.reviews[project] ?? []).map((pull) => ({
      task: pull.task,
      number: pull.number,
      url: pull.url,
      feedback: pull.feedback !== undefined,
      ...(pull.closed !== undefined && { closed: pull.closed }),
    }))
  }

  /** How the cleanup after the task goes when it has a pull request; `undefined` — it has none. */
  cleanupOf(project: string, task: string): PullCleanup | undefined {
    const pull = this.recordOf(project, task)
    return pull === undefined ? undefined : { force: true, remote: pull.remote }
  }

  /**
   * The task is done and cleaned up after. Done in the tracker before a poll saw its pull request merged — a forge's
   * integration with the tracker closes it on the merge — it would leave no line in the log otherwise.
   */
  closedUp(project: string, task: string): void {
    const pull = this.recordOf(project, task)
    if (pull !== undefined && pull.closed === undefined) this.deps.log(`review: ${task} is done in the tracker, its pull request ${pull.url} is not followed any more`)
    this.refused.delete(task)
    this.drop(project, task)
  }

  drop(project: string, task: string): void {
    const kept = (this.state.reviews[project] ?? []).filter((pull) => pull.task !== task)
    if (kept.length === 0) delete this.state.reviews[project]
    else this.state.reviews[project] = kept
  }

  /**
   * The current task's pull request on each step: `true` — the chain acted on it. A pull request closed unmerged
   * releases the task; a fresh mark opens the pull request and releases it; feedback goes to the waiting session.
   */
  async follow(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const { project } = chain
    const { task } = current
    if (this.review === undefined || this.deps.busy(task)) return false
    const pull = this.recordOf(project, task)
    if (pull?.closed === 'unmerged') {
      this.host.letGo(chain)
      return true
    }
    const session = this.deps.handoff(task)
    if (session === undefined || session.sessionId !== current.sessionId) return false
    const mark = session.pullRequest ?? null
    const tried = pull?.markAt === session.lastReplyAt || (this.refused.has(task) && this.refused.get(task) === session.lastReplyAt)
    if (this.review.on(project) && mark !== null && !tried) {
      await this.open(chain, current, { ...session, pullRequest: mark })
      return true
    }
    if (pull?.feedback === undefined || pull.closed !== undefined) return false
    if (this.deps.blocked(project, task) !== undefined || this.deps.limitReset(project, task) !== null) return false
    await this.deliver(chain, current, pull, pull.feedback)
    return true
  }

  private async open(chain: ActiveChain, current: CurrentTask, session: HandoffSession): Promise<void> {
    const { project } = chain
    const { task } = current
    const at = this.deps.now().toISOString()
    let opened: Awaited<ReturnType<ReviewDeps['open']>>
    try {
      opened = await this.review!.open(project, task, session)
    } catch (error) {
      this.refused.set(task, session.lastReplyAt)
      const why = noticeOf(error)
      if (why.code === 'review.nothingAhead') {
        // Even Keel cannot tell work already in main from work never committed: the session says which (BTN-222).
        // It is told as a chat answer is, by `--resume` whatever its cache: the reply belongs to its own turn.
        this.deps.log(`review: ${task}: no pull request opened, ${englishOf(why)}; the session is told`)
        const text = PROMPTS[this.deps.promptLanguage()].review.nothingAhead(this.deps.mainBranch(task))
        await this.handovers.deliver(chain, current, session, text, null, 'review')
      } else this.host.hold(chain, notice('review.notOpened', { task }, { cause: why }))
      return
    }
    this.refused.delete(task)
    const before = this.recordOf(project, task)
    const { number, url, branch, pushedAt, remote } = opened
    const pull: PullRequest = { seen: [], at, ...before, task, remote, number, url, branch, pushedAt, markAt: session.lastReplyAt }
    delete pull.feedback
    this.drop(project, task)
    ;(this.state.reviews[project] ??= []).push(pull)
    this.deps.journal({ at, project, task, sessionId: current.sessionId!, reason: 'review' })
    this.deps.log(`chain: ${project}: ${task} is out for review in ${url}`)
    this.host.letGo(chain)
    this.deps.save(this.state)
    this.host.refilter(project)
  }

  /** The feedback resumes the session while its cache is warm, else a new session takes the task with it. */
  private async deliver(chain: ActiveChain, current: CurrentTask, pull: PullRequest, feedback: string): Promise<void> {
    const session = this.deps.handoff(current.task)!
    const account = this.deps.account(chain.project, current.task)
    const now = this.deps.now().getTime()
    const warm =
      account.id !== null &&
      session.lastReplyAt !== null &&
      account.id === this.deps.accountAt(session.account, session.lastReplyAt) &&
      now - Date.parse(session.lastReplyAt) < WARM_CACHE_MS
    delete pull.feedback
    if (warm) await this.handovers.deliver(chain, current, session, feedback, null, 'review')
    else await this.handovers.handOverCurrent(chain, current, session, 'review', feedback)
    if (chain.current !== current) {
      pull.feedback = feedback
      this.deps.save(this.state)
    }
  }

  /** A launch of the task carried its feedback. */
  delivered(project: string, task: string): void {
    const pull = this.recordOf(project, task)
    if (pull !== undefined) delete pull.feedback
  }

  /** Asks the forges about every open pull request; nothing of the chain is touched while the answers come. */
  async poll(): Promise<Polled[]> {
    const review = this.review
    if (review === undefined) return []
    const open = Object.entries(this.state.reviews).flatMap(([project, pulls]) => pulls.filter((pull) => pull.closed === undefined).map((pull) => ({ project, pull })))
    const polled = await Promise.all(
      open.map(async ({ project, pull }): Promise<Polled | null> => {
        try {
          return { project, pull: structuredClone(pull), check: await review.check(project, pull) }
        } catch (error) {
          this.deps.log(`review: ${pull.task}: ${pull.url} was not polled: ${englishOf(noticeOf(error))}`)
          return null
        }
      }),
    )
    return polled.filter((each) => each !== null)
  }

  /** What the poll found, applied: returns the projects whose tasks need the chain's filter again. */
  async apply(polled: Polled[]): Promise<Set<string>> {
    const touched = new Set<string>()
    for (const { project, pull: asked, check } of polled) {
      const pull = this.recordOf(project, asked.task)
      if (pull === undefined || pull.number !== asked.number || pull.closed !== undefined) continue
      const outcome = outcomeOf(pull, check)
      if (outcome.kind === 'none') continue
      touched.add(project)
      if (outcome.kind === 'merged') {
        pull.closed = 'merged'
        delete pull.feedback
        this.deps.log(`review: ${pull.task}: ${pull.url} is merged`)
        await this.complete(project, pull.task)
        this.host.release(project, pull.task)
      } else if (outcome.kind === 'closed') {
        pull.closed = 'unmerged'
        delete pull.feedback
        this.deps.log(`review: ${pull.task}: ${pull.url} is closed unmerged, the task is skipped`)
      } else {
        const language = this.deps.promptLanguage()
        const text = feedbackText(pull.url, outcome.items, language, this.deps.mainBranch(pull.task))
        pull.feedback = withFeedback(pull.feedback, text, language)
        pull.seen.push(...outcome.items.map(eventKey))
        this.deps.log(`review: ${pull.task}: ${pull.url} got feedback (${outcome.items.map(eventKey).join(', ')})`)
      }
    }
    if (touched.size > 0) this.deps.save(this.state)
    return touched
  }

  private async complete(project: string, task: string): Promise<void> {
    try {
      await this.review!.complete(project, task)
      this.deps.log(`review: ${task} is moved to done in the tracker`)
    } catch (error) {
      this.deps.log(`review: ${task} was not moved to done in the tracker: ${englishOf(noticeOf(error))}`)
    }
  }

  /**
   * Cleans up after the tasks whose pull requests were closed unmerged, once no chain leads them and their sessions
   * rest. The task, open still, comes back to the chain skipped: it is the user's to run again.
   */
  async sweep(): Promise<void> {
    for (const [project, pulls] of Object.entries(this.state.reviews)) {
      for (const pull of pulls.filter((each) => each.closed === 'unmerged')) {
        const led = this.state.active.some((chain) => chain.project === project && chain.current?.task === pull.task)
        if (led || this.host.working(pull.task)) continue
        await this.host.dropUnmerged(project, pull.task, { force: true, remote: pull.remote, unmerged: true })
        this.drop(project, pull.task)
        const skipped = (this.state.skipped[project] ??= [])
        if (!skipped.includes(pull.task)) skipped.push(pull.task)
        this.deps.save(this.state)
        this.host.refilter(project)
      }
    }
  }
}
