import { shortCommit } from '../ci/verdict.js'
import { englishOf, notice, noticeOf, type Notice } from '../notice/notice.js'
import { isFixName } from './fix.js'
import type { AfterGreenRun, ChainState, MainCheckDeps, MainCheckRun, MainFailure, MainGate, MainPush, RedReport, SessionFix } from './model.js'

/** How long the chain waits for the tracker to list the fix task it has just created. */
export const FIX_LISTED_MS = 5 * 60_000

/** How long a push left unchecked because no runner took it is still watched for a late verdict (BTN-719). */
export const LATE_MS = 60 * 60_000

export interface MainStop {
  project: string
  notice: Notice
}

type IsOpen = (project: string, task: string) => boolean

/** The fix of the remote's red main another project (`by`) is doing; `at` — when it began. */
export interface PeerFix {
  by: string
  task: string
  commit: string
  at: string
}

/** The tasks of the project's pushes still awaiting a verdict. */
const pushedTasks = (gate: MainGate): string[] => [...(gate.check?.tasks ?? []), ...(gate.local?.tasks ?? [])]

// The CI after a push of main (BTN-103): the next launch waits for its verdict, a red main becomes one fix task,
// and a red push of that fix stops the chain instead of filing another. Without a CI to judge it, the project's
// own check does (BTN-104): before the merge on the task's branch, and on main in the next task's place if main moved.
// With `ci.fixTask` off (BTN-115) the fix is a session without a task, which the dispatcher starts (`MainFix`).
// A green main runs the project's `commands.afterGreen` in its checkout (BTN-156), one run at a time per project.
// Projects of one remote and main branch (BTN-217) share the fix: while one fixes a red main, the others' launches wait
// and their red pushes start no second fix.
export class MainCheck {
  private readonly prepared = new Map<string, string>()
  /** The run of `commands.afterGreen` going on, by project, and the green push due after it. */
  private readonly afterRuns = new Map<string, { commit: string; since: string; next?: MainPush }>()
  /** The remote's main of each project as last seen; the first look is no push. */
  private readonly remotes = new Map<string, string>()
  /** The latest push of main the chain did not make, by project (BTN-707): awaited only for `commands.afterGreen`, it holds no launch. */
  private readonly outside = new Map<string, MainPush>()
  /**
   * The chain's push that stayed unchecked because no runner took it in time, by project (BTN-719): the launch went on,
   * but a run taken later still judges it, a red one as any red main. The next push of the chain or `LATE_MS` ends the watch.
   */
  private readonly late = new Map<string, MainPush>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: MainCheckDeps,
    private readonly now: () => Date,
    private readonly log: (message: string) => void,
    /** `save` — the state must reach the disk now; `wake` — a run of `commands.afterGreen` ended. */
    private readonly hooks: { save: () => void; wake: () => void },
  ) {}

  /** The run of the project's `commands.afterGreen` the next launch waits for. */
  afterGreenRun(project: string): { commit: string; since: string } | undefined {
    const run = this.afterRuns.get(project)
    return run === undefined ? undefined : { commit: run.commit, since: run.since }
  }

  /** The tree of the task's branch, read before its cleanup deletes the branch; `null` — unknown. */
  async taskTree(project: string, task: string): Promise<string | null> {
    try {
      return await this.deps.taskTree(project, task)
    } catch {
      return null
    }
  }

  /** After the cleanup of a done task synced main: the CI's verdict on the commit is awaited. */
  async pushed(project: string, task: string, tree: string | null): Promise<void> {
    let commit: string | null
    try {
      commit = await this.deps.head(project)
    } catch (error) {
      this.log(`ci: ${project}: main after ${task} is unknown: ${englishOf(noticeOf(error))}`)
      return
    }
    if (commit === null) return
    if (this.outside.get(project)?.commit === commit) this.outside.delete(project)
    const gate = this.gate(project)
    if (gate.check?.commit === commit) {
      if (!gate.check.tasks.includes(task)) gate.check.tasks.push(task)
      return
    }
    if (gate.green === commit) return
    this.late.delete(project)
    const checked = tree !== null && (await this.deps.tree(project, commit).catch(() => null)) === tree
    const earlier = [...(gate.local?.tasks ?? []), ...(gate.check?.tasks ?? [])]
    delete gate.local
    const push: MainPush = { commit, at: this.now().toISOString(), tasks: [...earlier, task], ...(checked ? { checked: true as const } : {}) }
    if (this.deps.verdict(project, commit, push.at).state === 'none') {
      delete gate.check
      this.withoutCi(project, gate, push, [])
      return
    }
    gate.check = push
    this.log(`ci: ${project}: main is at ${shortCommit(commit)} after ${push.tasks.join(', ')}; waiting for the CI`)
  }

  /**
   * The push the next launch of the project waits on; `fix` — the tracker has yet to list the fix task; a `PeerFix` —
   * another project of the remote is fixing its red main.
   */
  holds(project: string, listed: string[], open: IsOpen): MainPush | 'fix' | PeerFix | null {
    return this.ownHold(project, listed) ?? this.peerFix(project, open) ?? null
  }

  private ownHold(project: string, listed: string[]): MainPush | 'fix' | null {
    const gate = this.state.ci[project]
    if (gate === undefined) return null
    const now = this.now().getTime()
    if (gate.check !== undefined) {
      const wait = this.deps.waitMs(project)
      if (wait === null || now - Date.parse(gate.check.at) < wait) return gate.check
    }
    const fix = gate.fix
    const awaited = fix !== undefined && !isFixName(fix.task) && !listed.includes(fix.task) && !pushedTasks(gate).includes(fix.task)
    return awaited && now - Date.parse(fix.at) < FIX_LISTED_MS ? 'fix' : null
  }

  /**
   * The fix of a red main another project of the same remote is doing (BTN-217): a session about to start or at work,
   * a fix task still open, or a push of either still awaiting its verdict. A fix task gone from the tracker with no push
   * of it holds nobody.
   */
  private peerFix(project: string, open: IsOpen): PeerFix | undefined {
    for (const peer of this.deps.peers(project)) {
      const gate = this.state.ci[peer]
      const fix = gate?.fix
      if (gate === undefined || fix === undefined) continue
      const live = fix.report !== undefined || pushedTasks(gate).includes(fix.task) || open(peer, fix.task)
      if (live) return { by: peer, task: fix.task, commit: fix.commit, at: fix.at }
    }
    return undefined
  }

  /** The fix a session without a task does or is about to do; gone once its branch has landed. */
  sessionFix(project: string): SessionFix | undefined {
    const fix = this.state.ci[project]?.fix
    return fix?.report === undefined ? undefined : { task: fix.task, commit: fix.commit, report: fix.report }
  }

  /**
   * The fix session's branch is in main and cleaned up: its push, if one went out, is what judges the fix.
   * Returns the commit main went out at, `null` when it is not known.
   */
  fixLanded(project: string): string | null {
    const gate = this.state.ci[project]
    const fix = gate?.fix
    if (gate === undefined) return null
    if (fix !== undefined && pushedTasks(gate).includes(fix.task)) delete fix.report
    else delete gate.fix
    return gate.check?.commit ?? gate.local?.commit ?? gate.green ?? null
  }

  /** The user gave the fix session up: main stays as it is. */
  dropFix(project: string): void {
    delete this.state.ci[project]?.fix
  }

  merged(project: string, task: string): Promise<boolean> {
    return this.deps.merged(project, task).catch(() => false)
  }

  /** The fix task goes before the chain's order while it is open in the chain. */
  fixOf(project: string, listed: string[]): string | undefined {
    const task = this.state.ci[project]?.fix?.task
    return task !== undefined && listed.includes(task) ? task : undefined
  }

  /** Prepares the place of the task the chain waits to launch, once per task. */
  ahead(project: string, task: string): void {
    if (this.prepared.get(project) === task) return
    this.prepared.set(project, task)
    this.deps.prepare(project, task).catch((error: unknown) => {
      this.log(`chain: ${project}: ${task} was not prepared ahead: ${englishOf(noticeOf(error))}`)
    })
  }

  /** The push of main the project's check runs on before the next launch. */
  due(project: string): MainPush | undefined {
    return this.state.ci[project]?.local
  }

  /** Runs the project's check on main in the place of `task`; returns why the chain must stop, if it must. */
  async checkLocally(project: string, task: string, open: IsOpen): Promise<Notice | null> {
    const gate = this.state.ci[project]
    const push = gate?.local
    if (gate === undefined || push === undefined) return null
    let run: MainCheckRun
    try {
      run = await this.deps.checkMain(project, task, push.commit)
    } catch (error) {
      run = { state: 'skipped', reason: englishOf(noticeOf(error)) }
    }
    delete gate.local
    if (run.state === 'green') this.passed(project, gate, push, `passed the check in the place of ${task}`)
    else if (run.state === 'red') return this.red(project, gate, push, { check: run.failure }, open)
    else this.unchecked(project, gate, push, run.reason)
    return null
  }

  /**
   * Asks for the verdict on every awaited push; returns the chains a red push of a fix must stop and the projects
   * whose red main a session without a task is to fix.
   */
  async settle(open: IsOpen): Promise<{ changed: boolean; stops: MainStop[]; fixes: string[] }> {
    const stops: MainStop[] = []
    const fixes: string[] = []
    let changed = this.settleOutside()
    for (const [project, gate] of Object.entries(this.state.ci)) {
      const push = gate.check
      if (push === undefined) continue
      const verdict = this.deps.verdict(project, push.commit, push.at)
      if (verdict.state === 'pending') continue
      changed = true
      delete gate.check
      if (verdict.state === 'green') {
        this.passed(project, gate, push, 'is green')
      } else if (verdict.state === 'red') {
        const before = gate.fix
        const stop = await this.red(project, gate, push, { ci: verdict.failed }, open)
        if (stop !== null) stops.push({ project, notice: stop })
        else if (gate.fix !== before && gate.fix?.report !== undefined) fixes.push(project)
      } else {
        this.withoutCi(project, gate, push, verdict.state === 'unavailable' ? verdict.reasons : [])
      }
    }
    changed = (await this.settleLate(open, stops, fixes)) || changed
    return { changed, stops, fixes }
  }

  /** A late verdict on a push left unchecked for want of a runner: green as any green, red files the fix as any red main. */
  private async settleLate(open: IsOpen, stops: MainStop[], fixes: string[]): Promise<boolean> {
    let changed = false
    for (const [project, push] of [...this.late]) {
      const verdict = this.deps.verdict(project, push.commit, push.at)
      const gate = this.gate(project)
      if (verdict.state === 'green') {
        this.late.delete(project)
        changed = true
        this.passed(project, gate, push, 'is green after all')
      } else if (verdict.state === 'red') {
        this.late.delete(project)
        changed = true
        const before = gate.fix
        const stop = await this.red(project, gate, push, { ci: verdict.failed }, open)
        if (stop !== null) stops.push({ project, notice: stop })
        else if (gate.fix !== before && gate.fix?.report !== undefined) fixes.push(project)
      } else if (verdict.state === 'none') {
        this.late.delete(project)
      } else if (this.now().getTime() - Date.parse(push.at) >= LATE_MS) {
        this.late.delete(project)
        this.log(`ci: ${project}: ${shortCommit(push.commit)} was not judged within ${LATE_MS / 60_000} minutes; no longer watched`)
      }
    }
    return changed
  }

  /**
   * Notes a move of the remote's main the chain did not make, a `git push` by hand, and judges the latest one awaited
   * (BTN-707). A green one runs `commands.afterGreen` as a push of the chain would; a red one files no fix and stops nothing.
   * Runs before the chain's own pushes are judged, so a push of the chain is still in `check` when its move is seen.
   * Returns whether the state changed.
   */
  private settleOutside(): boolean {
    for (const [project, head] of Object.entries(this.deps.remoteHeads())) {
      const before = this.remotes.get(project)
      this.remotes.set(project, head)
      if (before === undefined || before === head) continue
      const gate = this.state.ci[project]
      if (gate !== undefined && (gate.check?.commit === head || gate.local?.commit === head || gate.green === head)) continue
      this.outside.set(project, { commit: head, at: this.now().toISOString(), tasks: [] })
      this.log(`ci: ${project}: main of the remote is at ${shortCommit(head)}, pushed outside the chain; waiting for the CI`)
    }
    let changed = false
    for (const [project, push] of this.outside) {
      const verdict = this.deps.verdict(project, push.commit, push.at)
      if (verdict.state === 'pending') continue
      this.outside.delete(project)
      const commit = shortCommit(push.commit)
      if (verdict.state === 'green') {
        changed = true
        this.passed(project, this.gate(project), push, 'is green, pushed outside the chain')
      } else if (verdict.state === 'red') {
        this.log(`ci: ${project}: ${commit} is red, pushed outside the chain; the chain does not fix it`)
      } else {
        const why = verdict.state === 'unavailable' ? `: ${verdict.reasons.map(englishOf).join('; ')}` : ''
        this.log(`ci: ${project}: ${commit} stays unchecked, pushed outside the chain${why}`)
      }
    }
    return changed
  }

  /** No CI judged the push: the project's check takes it, if the project has one. */
  private withoutCi(project: string, gate: MainGate, push: MainPush, reasons: Notice[]): void {
    const commit = shortCommit(push.commit)
    const why = reasons.map(englishOf).join('; ')
    const { commands, recheck } = this.deps.checking(project)
    if (commands.length === 0) {
      if (this.fixed(gate, push)) delete gate.fix
      if (reasons.length > 0) this.log(`ci: ${project}: ${commit} stays unchecked: ${why}`)
      if (reasons.some((reason) => reason.code === 'ci.notTaken')) {
        this.late.set(project, push)
        this.log(`ci: ${project}: ${commit} is still watched: a run taken later judges it`)
      }
      return
    }
    if (reasons.length > 0) this.log(`ci: ${project}: the CI cannot judge ${commit} (${why}); the project's check takes it`)
    if (push.checked === true) this.passed(project, gate, push, 'is the tree the check passed before the merge')
    else if (!recheck) this.unchecked(project, gate, push, 'main moved past the checked branch, and the check of main is off')
    else {
      gate.local = push
      this.log(`ci: ${project}: ${commit} is checked in the next task's place before it starts`)
    }
  }

  private passed(project: string, gate: MainGate, push: MainPush, how: string): void {
    gate.green = push.commit
    if (this.fixed(gate, push)) delete gate.fix
    this.log(`ci: ${project}: ${shortCommit(push.commit)} ${how}`)
    this.afterGreen(project, gate, push)
  }

  /** The mark goes to the disk before the commands start: one of them may restart the service itself. */
  private afterGreen(project: string, gate: MainGate, push: MainPush): void {
    if (gate.afterGreen === push.commit || !this.deps.afterGreen(project)) return
    const running = this.afterRuns.get(project)
    if (running !== undefined) {
      running.next = push
      return
    }
    gate.afterGreen = push.commit
    this.afterRuns.set(project, { commit: push.commit, since: this.now().toISOString() })
    this.hooks.save()
    this.log(`afterGreen: ${project}: running the commands after ${shortCommit(push.commit)}`)
    void this.deps
      .runAfterGreen(project, push.commit)
      .catch((error: unknown): AfterGreenRun => ({ state: 'skipped', reason: englishOf(noticeOf(error)) }))
      .then((run) => this.afterGreenEnded(project, push, run))
  }

  private afterGreenEnded(project: string, push: MainPush, run: AfterGreenRun): void {
    const next = this.afterRuns.get(project)?.next
    this.afterRuns.delete(project)
    const commit = shortCommit(push.commit)
    if (run.state === 'done') this.log(`afterGreen: ${project}: the commands after ${commit} are done`)
    else if (run.state === 'skipped') this.log(`afterGreen: ${project}: skipped after ${commit}: ${run.reason}`)
    else {
      const { command, code } = run.failure
      this.log(`afterGreen: ${project}: ${command} after ${commit} exited with ${code}`)
      // A leftover is shown as the task's: a push from outside the chain has none, so its failure stays in the log.
      const task = push.tasks.at(-1)
      if (task !== undefined) (this.state.leftovers[project] ??= []).push({ task, at: this.now().toISOString(), notice: notice('afterGreen.failed', { command, code, commit }) })
    }
    if (next !== undefined) this.afterGreen(project, this.gate(project), next)
    this.hooks.wake()
  }

  private unchecked(project: string, gate: MainGate, push: MainPush, why: string): void {
    if (this.fixed(gate, push)) delete gate.fix
    this.log(`ci: ${project}: ${shortCommit(push.commit)} stays unchecked: ${why}`)
  }

  private fixed(gate: MainGate, push: MainPush): boolean {
    return gate.fix !== undefined && push.tasks.includes(gate.fix.task)
  }

  private async red(project: string, gate: MainGate, push: MainPush, failure: MainFailure, open: IsOpen): Promise<Notice | null> {
    const commit = shortCommit(push.commit)
    const ci = 'ci' in failure
    const what = ci ? 'red' : 'red by the check'
    if (this.fixed(gate, push)) {
      const task = gate.fix!.task
      delete gate.fix
      this.log(`ci: ${project}: ${commit} is ${what} after the fix ${task}; the chain stops`)
      return notice(ci ? 'ci.fixFailed' : 'check.fixFailed', { task, commit })
    }
    const fix = gate.fix
    if (fix?.report !== undefined) {
      this.log(`ci: ${project}: ${commit} is ${what}; the session ${fix.task} is already fixing main`)
      return null
    }
    // One fix per red main of a remote: a push carrying the commit another project already fixes waits for that fix.
    const peer = this.peerFix(project, open)
    if (peer !== undefined) {
      this.log(`ci: ${project}: ${commit} is ${what}; ${peer.task} of ${peer.by} is already fixing main of the remote`)
      return null
    }
    const byTask = this.deps.fixTask(project)
    let report: RedReport
    try {
      report = await this.deps.report(project, push, failure, this.greens(project))
    } catch (error) {
      const code = byTask ? (ci ? 'ci.fixNotCreated' : 'check.fixNotCreated') : ci ? 'ci.fixNotStarted' : 'check.fixNotStarted'
      return notice(code, { commit }, { cause: noticeOf(error) })
    }
    if (fix !== undefined && open(project, fix.task)) {
      try {
        await this.deps.comment(fix.task, report.comment)
        this.log(`ci: ${project}: ${commit} is ${what}; the log goes to ${fix.task}, still open`)
      } catch (error) {
        this.log(`ci: ${project}: ${commit} is ${what}; the comment on ${fix.task} failed: ${englishOf(noticeOf(error))}`)
      }
      return null
    }
    if (!byTask) {
      gate.fix = { task: this.deps.fixName(project), at: this.now().toISOString(), commit: push.commit, report: report.prompt }
      this.log(`ci: ${project}: ${commit} is ${what}; a session without a task fixes it`)
      return null
    }
    let task: string | null
    try {
      task = await this.deps.create(project, { title: report.title, description: report.description, priority: 'high', milestoneOf: push.tasks.at(-1) ?? null })
    } catch (error) {
      return notice(ci ? 'ci.fixNotCreated' : 'check.fixNotCreated', { commit }, { cause: noticeOf(error) })
    }
    if (task === null) return notice(ci ? 'ci.cannotCreate' : 'check.cannotCreate', { commit })
    gate.fix = { task, at: this.now().toISOString(), commit: push.commit }
    this.log(`ci: ${project}: ${commit} is ${what}; ${task} is created to fix it`)
    return null
  }

  /** The last green commit of the project and of each project of its remote and main branch: one main, so one history. */
  private greens(project: string): string[] {
    const all = [project, ...this.deps.peers(project)].map((each) => this.state.ci[each]?.green)
    return [...new Set(all.filter((green) => green !== undefined))]
  }

  private gate(project: string): MainGate {
    return (this.state.ci[project] ??= {})
  }
}
