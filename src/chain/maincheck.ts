import { shortCommit } from '../ci/verdict.js'
import { englishOf, notice, noticeOf, type Notice } from '../notice/notice.js'
import type { ChainState, MainCheckDeps, MainCheckRun, MainFailure, MainGate, MainPush, RedReport } from './model.js'

/** How long the chain waits for the tracker to list the fix task it has just created. */
export const FIX_LISTED_MS = 5 * 60_000

export interface MainStop {
  project: string
  notice: Notice
}

type IsOpen = (project: string, task: string) => boolean

// The CI after a push of main (BTN-103): the next launch waits for its verdict, a red main becomes one fix task,
// and a red push of that fix stops the chain instead of filing another. Without a CI to judge it, the project's
// own check does (BTN-104): before the merge on the task's branch, and on main in the next task's place if main moved.
export class MainCheck {
  private readonly prepared = new Map<string, string>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: MainCheckDeps,
    private readonly now: () => Date,
    private readonly log: (message: string) => void,
  ) {}

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
    const gate = this.gate(project)
    if (gate.check?.commit === commit) {
      if (!gate.check.tasks.includes(task)) gate.check.tasks.push(task)
      return
    }
    if (gate.green === commit) return
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

  /** The push the next launch of the project waits on; `fix` — the tracker has yet to list the fix task. */
  holds(project: string, listed: string[]): MainPush | 'fix' | null {
    const gate = this.state.ci[project]
    if (gate === undefined) return null
    const now = this.now().getTime()
    if (gate.check !== undefined) {
      const wait = this.deps.waitMs(project)
      if (wait === null || now - Date.parse(gate.check.at) < wait) return gate.check
    }
    const fix = gate.fix
    const pushed = [...(gate.check?.tasks ?? []), ...(gate.local?.tasks ?? [])]
    if (fix !== undefined && !listed.includes(fix.task) && !pushed.includes(fix.task) && now - Date.parse(fix.at) < FIX_LISTED_MS) return 'fix'
    return null
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

  /** Asks for the verdict on every awaited push; returns the chains a red push of a fix must stop. */
  async settle(open: IsOpen): Promise<{ changed: boolean; stops: MainStop[] }> {
    const stops: MainStop[] = []
    let changed = false
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
        const stop = await this.red(project, gate, push, { ci: verdict.failed }, open)
        if (stop !== null) stops.push({ project, notice: stop })
      } else {
        this.withoutCi(project, gate, push, verdict.state === 'unavailable' ? verdict.reasons : [])
      }
    }
    return { changed, stops }
  }

  /** No CI judged the push: the project's check takes it, if the project has one. */
  private withoutCi(project: string, gate: MainGate, push: MainPush, reasons: Notice[]): void {
    const commit = shortCommit(push.commit)
    const why = reasons.map(englishOf).join('; ')
    const { commands, recheck } = this.deps.checking(project)
    if (commands.length === 0) {
      if (this.fixed(gate, push)) delete gate.fix
      if (reasons.length > 0) this.log(`ci: ${project}: ${commit} stays unchecked: ${why}`)
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
    let report: RedReport
    try {
      report = await this.deps.report(project, push, failure, gate.green ?? null)
    } catch (error) {
      return notice(ci ? 'ci.fixNotCreated' : 'check.fixNotCreated', { commit }, { cause: noticeOf(error) })
    }
    const fix = gate.fix
    if (fix !== undefined && open(project, fix.task)) {
      try {
        await this.deps.comment(fix.task, report.comment)
        this.log(`ci: ${project}: ${commit} is ${what}; the log goes to ${fix.task}, still open`)
      } catch (error) {
        this.log(`ci: ${project}: ${commit} is ${what}; the comment on ${fix.task} failed: ${englishOf(noticeOf(error))}`)
      }
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

  private gate(project: string): MainGate {
    return (this.state.ci[project] ??= {})
  }
}
