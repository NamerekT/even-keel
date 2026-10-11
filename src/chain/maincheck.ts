import { shortCommit, type RedRun } from '../ci/verdict.js'
import { englishOf, notice, noticeOf, type Notice } from '../notice/notice.js'
import type { ChainState, MainCheckDeps, MainGate, MainPush, RedReport } from './model.js'

/** How long the chain waits for the tracker to list the fix task it has just created. */
export const FIX_LISTED_MS = 5 * 60_000

export interface MainStop {
  project: string
  notice: Notice
}

// The CI after a push of main (BTN-103): the next launch waits for its verdict, a red main becomes one fix task,
// and a red push of that fix stops the chain instead of filing another.
export class MainCheck {
  private readonly prepared = new Map<string, string>()

  constructor(
    private readonly state: ChainState,
    private readonly deps: MainCheckDeps,
    private readonly now: () => Date,
    private readonly log: (message: string) => void,
  ) {}

  /** After the cleanup of a done task synced main: the CI's verdict on the commit is awaited. */
  async pushed(project: string, task: string): Promise<void> {
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
    gate.check = { commit, at: this.now().toISOString(), tasks: [...(gate.check?.tasks ?? []), task] }
    this.log(`ci: ${project}: main is at ${shortCommit(commit)} after ${gate.check.tasks.join(', ')}; waiting for the CI`)
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
    if (fix !== undefined && !listed.includes(fix.task) && !gate.check?.tasks.includes(fix.task) && now - Date.parse(fix.at) < FIX_LISTED_MS) return 'fix'
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

  /** Asks for the verdict on every awaited push; returns the chains a red push of a fix must stop. */
  async settle(open: (project: string, task: string) => boolean): Promise<{ changed: boolean; stops: MainStop[] }> {
    const stops: MainStop[] = []
    let changed = false
    for (const [project, gate] of Object.entries(this.state.ci)) {
      const push = gate.check
      if (push === undefined) continue
      const verdict = this.deps.verdict(project, push.commit, push.at)
      if (verdict.state === 'pending') continue
      changed = true
      delete gate.check
      const fixed = gate.fix !== undefined && push.tasks.includes(gate.fix.task)
      const commit = shortCommit(push.commit)
      if (verdict.state === 'green') {
        gate.green = push.commit
        if (fixed) delete gate.fix
        this.log(`ci: ${project}: ${commit} is green`)
      } else if (verdict.state === 'red') {
        const stop = await this.red(project, gate, push, verdict.failed, fixed, open)
        if (stop !== null) stops.push({ project, notice: stop })
      } else {
        if (fixed) delete gate.fix
        if (verdict.state === 'unavailable') this.log(`ci: ${project}: ${commit} stays unchecked: ${verdict.reasons.map(englishOf).join('; ')}`)
      }
    }
    return { changed, stops }
  }

  private async red(project: string, gate: MainGate, push: MainPush, failed: RedRun[], fixed: boolean, open: (project: string, task: string) => boolean): Promise<Notice | null> {
    const commit = shortCommit(push.commit)
    if (fixed) {
      const task = gate.fix!.task
      delete gate.fix
      this.log(`ci: ${project}: ${commit} is red after the fix ${task}; the chain stops`)
      return notice('ci.fixFailed', { task, commit })
    }
    let report: RedReport
    try {
      report = await this.deps.report(project, push, failed, gate.green ?? null)
    } catch (error) {
      return notice('ci.fixNotCreated', { commit }, { cause: noticeOf(error) })
    }
    const fix = gate.fix
    if (fix !== undefined && open(project, fix.task)) {
      try {
        await this.deps.comment(fix.task, report.comment)
        this.log(`ci: ${project}: ${commit} is red; the log goes to ${fix.task}, still open`)
      } catch (error) {
        this.log(`ci: ${project}: ${commit} is red; the comment on ${fix.task} failed: ${englishOf(noticeOf(error))}`)
      }
      return null
    }
    let task: string | null
    try {
      task = await this.deps.create(project, { title: report.title, description: report.description, priority: 'high', milestoneOf: push.tasks.at(-1) ?? null })
    } catch (error) {
      return notice('ci.fixNotCreated', { commit }, { cause: noticeOf(error) })
    }
    if (task === null) return notice('ci.cannotCreate', { commit })
    gate.fix = { task, at: this.now().toISOString(), commit: push.commit }
    this.log(`ci: ${project}: ${commit} is red; ${task} is created to fix it`)
    return null
  }

  private gate(project: string): MainGate {
    return (this.state.ci[project] ??= {})
  }
}
