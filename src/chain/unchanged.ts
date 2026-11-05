import type { Changes } from '../git/types.js'
import { notice, noticeOf, type Notice } from '../notice/notice.js'
import { isFixName } from './fix.js'
import type { Handovers } from './handover.js'
import type { ActiveChain, CurrentTask, DispatcherDeps } from './model.js'
import { PROMPTS } from './prompts.js'

// Out of PR mode a session merges its branch, and the merge closes the task. A task with nothing to merge — done in
// main already, research, an answer — never closes that way: its session ends the turn with `NO CHANGES: <why>`
// instead (EKR-10). With nothing beyond main and a clean worktree the task is moved to Done with the reason as a
// comment, and the chain's own Done cleans up after it (invariant 1, exception 4); otherwise the session is told.
// A fix session of a red main marks it too when the code is not broken (EKR-88): `MainFix.unneeded` takes it from there.
export class Unchanged {
  /** The `lastReplyAt` of each task's mark acted on: only a new turn of the session marks again. A service restart forgets it. */
  private readonly tried = new Map<string, string | null>()
  /** The `lastReplyAt` of each task's mark found clean and not acted on yet: a fix of main waits on it for a verdict. */
  private readonly clean = new Map<string, string | null>()

  constructor(
    private readonly deps: DispatcherDeps,
    private readonly handovers: Handovers,
    /** Pauses the chain on its current task, which stays current. */
    private readonly hold: (chain: ActiveChain, error: Notice) => void,
  ) {}

  /** The current task's mark on each step: `true` — the chain acted on it. */
  async follow(chain: ActiveChain, current: CurrentTask): Promise<boolean> {
    const mark = await this.check(chain, current)
    if (mark === null) return false
    if (mark === 'acted') return true
    const { project } = chain
    const { task } = current
    this.clean.delete(task)
    const main = this.deps.mainBranch(task)
    const texts = PROMPTS[this.deps.promptLanguage(task)].unchanged
    this.deps.log(`chain: ${task} needs no change and its branch has nothing beyond ${main}; the task is done`)
    try {
      await this.deps.unchanged!.complete(project, task, texts.comment(mark.reason))
    } catch (error) {
      this.hold(chain, notice('chain.unchangedNotCompleted', { task }, { cause: noticeOf(error) }))
      return true
    }
    this.deps.log(`chain: ${task} is moved to done in the tracker`)
    await this.deps.refresh(project).catch(() => undefined)
    return true
  }

  /**
   * The current session's `NO CHANGES:` mark: `null` — none to act on; `acted` — the chain halted or the session was told
   * its branch is not clean; a reason — the branch has nothing beyond main, asked again on each step until the session
   * takes another turn (a fix of main waits on it for the verdict, EKR-88).
   */
  async check(chain: ActiveChain, current: CurrentTask): Promise<{ reason: string } | 'acted' | null> {
    const unchanged = this.deps.unchanged
    const { project } = chain
    const { task } = current
    // A turn that ended on a background command is over, as for Done (BTN-202): only a clean branch goes on without it.
    const busy = this.deps.busy(task)
    const shell = busy && this.deps.shell(task)
    // A fix of main merges by itself even in PR mode, so it marks no pull request either.
    if (unchanged === undefined || (busy && !shell) || (!isFixName(task) && this.deps.pullRequests?.(task) === true)) return null
    const session = this.deps.handoff(task)
    if (session === undefined || session.sessionId !== current.sessionId) return null
    const reason = session.noChanges ?? null
    if (reason === null) return null
    if (this.clean.has(task) && this.clean.get(task) === session.lastReplyAt) return { reason }
    if (this.tried.has(task) && this.tried.get(task) === session.lastReplyAt) return null
    this.tried.set(task, session.lastReplyAt)
    const main = this.deps.mainBranch(task)
    const texts = PROMPTS[this.deps.promptLanguage(task)].unchanged

    let changes: Changes
    try {
      changes = await unchanged.changes(project, session.workdir)
    } catch (error) {
      this.hold(chain, notice('chain.unchangedNotChecked', { task }, { cause: noticeOf(error) }))
      return 'acted'
    }
    if (changes.ahead > 0 || changes.files > 0) {
      if (shell) {
        // The work is not over: the session is told once its command ends or counts as hung.
        this.tried.delete(task)
        return null
      }
      // Told as a chat answer is, by `--resume` whatever its cache: the reply belongs to the session's own turn.
      const what = changes.ahead > 0 ? `${changes.ahead} commit(s) beyond ${main}` : 'uncommitted changes'
      this.deps.log(`chain: ${task} is marked as needing no change, but its branch has ${what}; the session is told`)
      await this.handovers.deliver(chain, current, session, changes.ahead > 0 ? texts.ahead(main) : texts.dirty(main), null)
      return 'acted'
    }
    this.clean.set(task, session.lastReplyAt)
    return { reason }
  }
}
