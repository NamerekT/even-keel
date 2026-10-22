import { Skipped } from '../github/trust.js'
import type { Language } from '../language.js'
import { englishOf, noticeOf } from '../notice/notice.js'
import type { StatusCategory } from '../tracker/model.js'
import type { IntakeRepo } from './github.js'
import { copyOf, nextVersion, shippedLine, taskOf, voiceOf, type IntakeComment, type IntakeEntry, type IntakeIssue } from './model.js'

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
      for (const place of places) await this.guarded(`${place.slug} (${place.label})`, () => this.take(place))
      for (const entry of [...this.entries]) {
        const place = places.find((each) => each.project === entry.project && same(each.slug, entry.repo))
        if (place !== undefined) await this.guarded(`${entry.repo}#${entry.number}`, () => this.follow(entry, place))
      }
    } finally {
      this.running = false
    }
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
      const comments = await place.repo.comments(issue.number, 0)
      this.skip(place.slug, issue, comments)
      const task = await this.deps.create(place.project, taskOf(issue, comments, this.deps.language(place.project)))
      this.store([...this.entries, { project: place.project, repo: place.slug, number: issue.number, task, seen: comments.at(-1)?.id ?? 0 }])
      this.deps.log(`intake: ${place.slug}#${issue.number} is taken in as ${task}`)
    }
  }

  private async follow(entry: IntakeEntry, place: IntakePlace): Promise<void> {
    const where = `${entry.repo}#${entry.number}`
    const issue = await place.repo.issue(entry.number)
    if (issue === null || !issue.open) return this.drop(entry, `intake: ${where} is closed on GitHub; ${entry.task} is not followed any more`)
    if (entry.shipped !== undefined) {
      const { version, at } = entry.shipped
      if (!(await (version === null ? place.repo.releasedSince(at) : place.repo.released(version)))) return
      await place.repo.close(entry.number)
      return this.drop(entry, `intake: ${where} is closed: ${version ?? 'a release'} is out with ${entry.task}`)
    }
    const task = await this.deps.task(entry.project, entry.task)
    if (task === null || task.category === 'Lost') return this.drop(entry, `intake: ${entry.task} is gone or dropped; ${where} is not followed any more`)
    if (task.category === 'Won') {
      const tags = nextVersion(task.milestone, []) === null ? [] : await place.repo.tags('v')
      const version = nextVersion(task.milestone, tags)
      await place.repo.comment(entry.number, shippedLine(version))
      this.update(entry, { shipped: { version, at: this.deps.now().toISOString() } })
      this.deps.log(`intake: ${where}: ${entry.task} is done, the issue says it ships in ${version ?? 'the next release'}`)
      return
    }
    let current = entry
    for (const comment of await place.repo.comments(entry.number, entry.seen)) {
      const voice = voiceOf(comment, issue)
      if (voice === null) this.skipOne(entry.repo, issue, comment)
      else await this.deps.comment(entry.project, entry.task, copyOf(comment, voice, this.deps.language(entry.project)))
      current = this.update(current, { seen: comment.id })
    }
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

  private update(entry: IntakeEntry, change: Partial<IntakeEntry>): IntakeEntry {
    const next = { ...entry, ...change }
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
