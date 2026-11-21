import { changedAfterEntry, DEFAULT_RULES } from '../chain/rules.js'
import { Skipped, trustedAuthor } from '../github/trust.js'
import type { Language } from '../language.js'
import { englishOf, noticeOf } from '../notice/notice.js'
import type { StatusCategory } from '../tracker/model.js'
import { templateHits, type IssueTemplate, type TemplateHit } from '../tracker/templates.js'
import type { IntakeRepo } from './github.js'
import { copyOf, nextVersion, outsiderIssue, shippedLine, taskOf, voiceOf, type IntakeComment, type IntakeEntry, type IntakeIssue } from './model.js'

/** A project that takes the issues of a GitHub repository in: those with `label`, through `repo`'s calls. */
export interface IntakePlace {
  project: string
  /** `owner/name`. */
  slug: string
  label: string
  repo: IntakeRepo
}

export interface IntakeDeps {
  /** The projects that take issues in now; one with no GitHub remote, no token or a tracker that cannot create a task is left out. */
  places(): IntakePlace[]
  language(project: string): Language
  /** The new task's id in the project's tracker. */
  create(project: string, task: { title: string; description: string }): Promise<string>
  comment(project: string, task: string, body: string): Promise<void>
  /** `null` — the tracker has no such task any more. */
  task(project: string, task: string): Promise<{ category: StatusCategory; milestone: string | null } | null>
  load(): IntakeEntry[]
  save(entries: IntakeEntry[]): void
  now(): Date
  log(line: string): void
  /** The issue templates of the place's repository (BTN-1130); `null` — not known. None — not read. */
  templates?(place: IntakePlace): Promise<IssueTemplate[] | null>
  /** Filled by each tick: by project, the templates that put its label on for any author. */
  templateHits?: Record<string, TemplateHit[]>
  /** `templateHits` changed. */
  changed?(): void
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Takes the GitHub issues a project's label marks into its tracker, copies the later comments of collaborators and of
 * the issue's author to the task, says on the issue in one line which version ships the done task, and closes the
 * issue once that version is released (BTN-262). The work and its decisions stay in the tracker.
 */
export class Intake {
  private entries: IntakeEntry[]
  private running = false
  private readonly skipped: Skipped

  constructor(private readonly deps: IntakeDeps) {
    this.entries = deps.load()
    this.skipped = new Skipped(deps.log)
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const places = this.deps.places()
      await this.checkTemplates(places)
      for (const place of places) await this.guarded(`${place.slug} (${place.label})`, () => this.take(place))
      for (const entry of [...this.entries]) {
        const place = places.find((each) => each.project === entry.project && same(each.slug, entry.repo))
        if (place !== undefined) await this.guarded(`${entry.repo}#${entry.number}`, () => this.follow(entry, place))
      }
    } finally {
      this.running = false
    }
  }

  /** A template that puts the label on lets any author's issue in (BTN-1130); a failed read keeps the last answer. */
  private async checkTemplates(places: IntakePlace[]): Promise<void> {
    const { templates, templateHits: hits } = this.deps
    if (templates === undefined || hits === undefined) return
    const before = JSON.stringify(hits)
    for (const project of Object.keys(hits)) if (!places.some((place) => place.project === project)) delete hits[project]
    for (const place of places) {
      await this.guarded(`${place.slug} templates`, async () => {
        const found = templateHits((await templates(place)) ?? [], [place.label])
        if (found.length > 0) hits[place.project] = found
        else delete hits[place.project]
      })
    }
    if (JSON.stringify(hits) !== before) this.deps.changed?.()
  }

  private async guarded(what: string, step: () => Promise<void>): Promise<void> {
    try {
      await step()
    } catch (error) {
      this.deps.log(`intake: ${what}: ${englishOf(noticeOf(error))}`)
    }
  }

  private async take(place: IntakePlace): Promise<void> {
    for (const issue of await place.repo.labeled(place.label)) {
      if (this.entries.some((entry) => same(entry.repo, place.slug) && entry.number === issue.number)) continue
      if (await this.changed(place, issue)) continue
      const comments = await place.repo.comments(issue.number, 0)
      this.skip(place.slug, issue, comments)
      const task = await this.deps.create(place.project, taskOf(issue, comments, this.deps.language(place.project)))
      const entry: IntakeEntry = { project: place.project, repo: place.slug, number: issue.number, task, seen: comments.at(-1)?.id ?? 0 }
      this.store([...this.entries, outsiderIssue(issue) ? { ...entry, outsider: true } : entry])
      this.deps.log(`intake: ${place.slug}#${issue.number} is taken in as ${task}`)
    }
  }

  /**
   * An outsider's issue whose text its author changed after the label was put on (BTN-1124): the person let in a text the
   * task would not get. It waits, with a line in the log, until the label is put on again.
   */
  private async changed(place: IntakePlace, issue: IntakeIssue): Promise<boolean> {
    if (trustedAuthor(issue.association, issue.author, null)) return false
    const edited = await place.repo.edits(issue.number)
    const rules = { ...DEFAULT_RULES, requiredLabels: [place.label] }
    if (edited === undefined || !changedAfterEntry(rules, { labels: [place.label], outsider: true, edited })) return false
    this.skipped.note(
      `${place.slug}#${issue.number}@${edited.at}`,
      `intake: ${place.slug}#${issue.number} is not taken in: its author, not a member of the repository, changed its text after the label "${place.label}" was put on; take the label off and put it on again`,
    )
    return true
  }

  /** Whether the project's task came from an outsider's issue (`IntakeEntry.outsider`). */
  outsider(project: string, task: string): boolean {
    return this.entries.some((entry) => entry.project === project && entry.task === task && entry.outsider === true)
  }

  private async follow(entry: IntakeEntry, place: IntakePlace): Promise<void> {
    const where = `${entry.repo}#${entry.number}`
    if (entry.closed === true) return this.followClosed(entry)
    const issue = await place.repo.issue(entry.number)
    if (issue === null || !issue.open) {
      if (entry.outsider !== true) return this.drop(entry, `intake: ${where} is closed on GitHub; ${entry.task} is not followed any more`)
      // Closing the issue must not let the outsider's task land unchecked.
      this.update(entry, { closed: true })
      this.deps.log(`intake: ${where} is closed on GitHub; ${entry.task} is not followed there any more and stays an outsider's task until it is done`)
      return
    }
    let current = outsiderIssue(issue) === (entry.outsider === true) ? entry : this.mark(entry, outsiderIssue(issue))
    if (current.shipped !== undefined) {
      const { version, at } = current.shipped
      if (!(await (version === null ? place.repo.releasedSince(at) : place.repo.released(version)))) return
      await place.repo.close(current.number)
      return this.drop(current, `intake: ${where} is closed: ${version ?? 'a release'} is out with ${current.task}`)
    }
    const task = await this.deps.task(current.project, current.task)
    if (task === null || task.category === 'Lost') return this.drop(current, `intake: ${current.task} is gone or dropped; ${where} is not followed any more`)
    if (task.category === 'Won') {
      const tags = nextVersion(task.milestone, []) === null ? [] : await place.repo.tags('v')
      const version = nextVersion(task.milestone, tags)
      await place.repo.comment(current.number, shippedLine(version))
      this.update(current, { shipped: { version, at: this.deps.now().toISOString() } })
      this.deps.log(`intake: ${where}: ${current.task} is done, the issue says it ships in ${version ?? 'the next release'}`)
      return
    }
    for (const comment of await place.repo.comments(current.number, current.seen)) {
      const voice = voiceOf(comment, issue)
      if (voice === null) this.skipOne(entry.repo, issue, comment)
      else await this.deps.comment(entry.project, entry.task, copyOf(comment, voice, this.deps.language(entry.project)))
      current = this.update(current, { seen: comment.id })
    }
  }

  private async followClosed(entry: IntakeEntry): Promise<void> {
    const task = await this.deps.task(entry.project, entry.task)
    if (task !== null && task.category !== 'Won' && task.category !== 'Lost') return
    this.drop(entry, `intake: ${entry.task} is done or gone; it is not held as an outsider's task any more`)
  }

  /** The author's standing changed since the issue was taken in: a collaborator now, or not any more. */
  private mark(entry: IntakeEntry, outsider: boolean): IntakeEntry {
    const { outsider: _, ...rest } = entry
    return this.update(entry, outsider ? { ...rest, outsider: true } : rest, true)
  }

  private skip(slug: string, issue: IntakeIssue, comments: IntakeComment[]): void {
    for (const comment of comments) if (voiceOf(comment, issue) === null) this.skipOne(slug, issue, comment)
  }

  private skipOne(slug: string, issue: IntakeIssue, comment: IntakeComment): void {
    if (comment.bot || comment.body.trim() === '') return
    this.skipped.note(
      `${slug}#${issue.number}:${comment.id}`,
      `intake: ${slug}#${issue.number}: the comment ${comment.id} of ${comment.author || 'a deleted account'} is not copied: its author is neither a collaborator nor the issue's author`,
    )
  }

  /** `whole` — `change` is the whole new entry, so a field it lacks is dropped. */
  private update(entry: IntakeEntry, change: Partial<IntakeEntry>, whole = false): IntakeEntry {
    const next = whole ? (change as IntakeEntry) : { ...entry, ...change }
    this.store(this.entries.map((each) => (each === entry ? next : each)))
    return next
  }

  private drop(entry: IntakeEntry, line: string): void {
    this.store(this.entries.filter((each) => each !== entry))
    this.deps.log(line)
  }

  private store(entries: IntakeEntry[]): void {
    this.entries = entries
    this.deps.save(entries)
  }
}
