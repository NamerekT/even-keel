import { fail } from '../notice/notice.js'
import type { ChangelogKind, ChangelogOp, ChangelogSpend, ChangelogVersion, ChangelogView } from '../state.js'
import type { Db } from '../storage/database.js'
import type { MilestoneTask } from '../tracker/source.js'
import { changelogPrompt, materialOf, type ChangelogMode } from './draft.js'
import { answerSection, changelogPlan, withSection, type ChangelogPlan } from './file.js'
import { addVersion, latestVersion, markWritten, spentOn, writtenTasks } from './store.js'

export interface ChangelogDeps {
  /** Every task of the project's milestone with its last comment; throws when the project's tracker cannot list them. */
  tasks(project: string, milestone: string): Promise<MilestoneTask[]>
  /** One read-only turn of the agent in the project's main checkout; its answer and what it cost on which account. */
  write(project: string, prompt: string): Promise<{ text: string; spend: ChangelogSpend }>
  /** The project's changelog file in its main checkout: the path the setting names and its text with LF line ends. */
  file(project: string): Promise<{ path: string; text: string | null }>
  /** The tags of the project's repository. */
  tags(project: string): Promise<string[]>
  /** Writes the file by `change` and commits it to the main branch (`commitChangelog`); the sha, `null` — unchanged. */
  commit(project: string, path: string, message: string, change: (text: string | null) => string): Promise<string | null>
  db: Db
  /** The project ids by key (`config.ids`). */
  ids(): Record<string, string>
  now(): Date
}

const headingOf = (text: string) => text.split('\n')[0]!.trimEnd()

/**
 * The changelog drafts of milestones (BTN-142, BTN-209). The file in the main checkout is the source: every turn starts
 * from its section of the milestone, so the user's own edits there are kept. Each answer is a version in the database,
 * the history of the dialog; "write" puts the newest one into the file by a commit. One operation runs at a time per
 * milestone, and a request while one runs gets that one's result: a turn is paid and a minute or two long.
 */
export class ChangelogDrafts {
  private readonly running = new Map<string, Promise<ChangelogView>>()
  private written: Record<string, Record<string, string[]>> = {}

  constructor(private readonly deps: ChangelogDeps) {}

  /** Reads the tasks of the written versions, for `writtenTasks`. */
  async load(): Promise<void> {
    this.written = await writtenTasks(this.deps.db, this.deps.ids())
  }

  /** The tasks the last written version of each milestone accounts for, by project key and milestone. */
  writtenTasks(): Record<string, Record<string, string[]>> {
    return this.written
  }

  run(project: string, milestone: string, op: ChangelogOp): Promise<ChangelogView> {
    const key = JSON.stringify([project, milestone])
    const running = this.running.get(key)
    if (running !== undefined) return running
    const next = this.step(project, milestone, op).finally(() => this.running.delete(key))
    this.running.set(key, next)
    return next
  }

  private async step(project: string, milestone: string, op: ChangelogOp): Promise<ChangelogView> {
    const { db } = this.deps
    const ids = this.deps.ids()
    const latest = await latestVersion(db, project, milestone, ids)
    const [file, tags] = await Promise.all([this.deps.file(project), this.deps.tags(project)])
    const plan = changelogPlan(file.text, milestone, tags)
    const view = async (version: ChangelogVersion): Promise<ChangelogView> => ({
      project,
      milestone,
      file: file.path,
      released: plan.tag,
      version,
      spent: await spentOn(db, project, milestone, ids),
    })
    if (op.op === 'open' && latest !== null) return view(latest)
    if (op.op === 'open' || op.op === 'again') return view(await this.fresh(project, milestone, plan, file.path, tags, op.op === 'open' ? 'draft' : 'again'))
    if (latest === null) throw fail('changelog.noDraft', { milestone })
    // A written version whose section has since been released is frozen: only new tasks go on, into the next patch's section.
    const frozen = latest.written !== null && plan.section === null && plan.tag !== null
    if (frozen && op.op !== 'add') throw fail('changelog.released', { milestone, tag: plan.tag ?? '' })
    if (op.op === 'write') return view(latest.written === null ? await this.commit(project, milestone, latest, tags) : latest)
    // Once written, the file's section is where the user's own edits are: the next version starts from it.
    const start = latest.written === null ? latest.text : (plan.section?.text ?? null)
    if (op.op === 'edit') {
      const section = start ?? latest.text
      const heading = headingOf(section)
      const answer = await this.turn(project, heading, { milestone, mode: 'edit', section, heading, tasks: [], released: plan.released.map((each) => each.text), tags, instruction: op.instruction, file: file.path })
      return view(await this.store(project, milestone, { kind: 'edit', ...answer, base: section, instruction: op.instruction.trim(), tasks: latest.tasks, open: latest.open }))
    }
    const material = materialOf(milestone, await this.deps.tasks(project, milestone))
    const accounted = new Set(latest.tasks)
    const missing = material.done.filter((task) => !accounted.has(task.id))
    if (missing.length === 0) throw fail('changelog.nothingNew', { milestone })
    const mode: ChangelogMode = start === null ? 'fresh' : 'update'
    const heading = start === null ? plan.heading : headingOf(start)
    const answer = await this.turn(project, heading, { milestone, mode, section: start, heading, tasks: missing, released: plan.released.map((each) => each.text), tags, file: file.path })
    const tasks = [...latest.tasks, ...missing.map((task) => task.id)]
    return view(await this.store(project, milestone, { kind: 'add', ...answer, base: start, instruction: null, tasks, open: material.open }))
  }

  /** The first draft or "write again": all done tasks; the section in the file, if there is one, is what it replaces. */
  private async fresh(project: string, milestone: string, plan: ChangelogPlan, file: string, tags: string[], kind: ChangelogKind): Promise<ChangelogVersion> {
    const material = materialOf(milestone, await this.deps.tasks(project, milestone))
    if (material.done.length === 0) throw fail('changelog.empty', { milestone })
    const section = plan.section?.text ?? null
    // The first draft keeps the user's section and works the tasks into it; "again" writes it anew.
    const mode: ChangelogMode = kind === 'draft' && section !== null ? 'update' : 'fresh'
    const heading = plan.section?.heading ?? plan.heading
    const released = plan.released.map((each) => each.text)
    const answer = await this.turn(project, heading, { milestone, mode, section: mode === 'update' ? section : null, heading, tasks: material.done, released, tags, file })
    return this.store(project, milestone, { kind, ...answer, base: section, instruction: null, tasks: material.done.map((task) => task.id), open: material.open })
  }

  private async turn(project: string, heading: string, request: Parameters<typeof changelogPrompt>[0]): Promise<{ text: string; spend: ChangelogSpend }> {
    const { text: answer, spend } = await this.deps.write(project, changelogPrompt(request))
    const text = answerSection(answer, heading)
    if (text === heading) throw fail('changelog.failed', { project })
    return { text, spend }
  }

  private async store(project: string, milestone: string, fields: Omit<ChangelogVersion, 'project' | 'milestone' | 'number' | 'at' | 'written'>): Promise<ChangelogVersion> {
    const version = { project, milestone, ...fields, at: this.deps.now().toISOString() }
    const number = await addVersion(this.deps.db, version, this.deps.ids())
    return { ...version, number, written: null }
  }

  private async commit(project: string, milestone: string, latest: ChangelogVersion, tags: string[]): Promise<ChangelogVersion> {
    const file = (await this.deps.file(project)).path
    // The file is read again under the commit: the user may have changed it while the dialog was open.
    const sha = await this.deps.commit(project, file, `Changelog of ${milestone}`, (text) => withSection(text, changelogPlan(text, milestone, tags), latest.text))
    const written = { at: this.deps.now().toISOString(), commit: sha ?? '' }
    await markWritten(this.deps.db, project, milestone, latest.number, written, this.deps.ids())
    ;(this.written[project] ??= {})[milestone] = latest.tasks
    return { ...latest, written }
  }
}
