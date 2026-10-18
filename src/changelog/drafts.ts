import { fail } from '../notice/notice.js'
import type { MilestoneTask } from '../tracker/source.js'
import { changelogPrompt, materialOf } from './draft.js'

export interface ChangelogDeps {
  /** Every task of the project's milestone with its last comment; throws when the project's tracker cannot list them. */
  tasks(project: string, milestone: string): Promise<MilestoneTask[]>
  /** One turn of the agent in the project's main checkout; its answer. */
  write(project: string, prompt: string): Promise<string>
  now(): Date
}

/** A milestone's changelog draft as the page shows it. */
export interface ChangelogDraft {
  /** The project key. */
  project: string
  milestone: string
  /** Markdown. */
  text: string
  /** How many done tasks it was written from. */
  done: number
  /** How many of the milestone's tasks were still open: the draft does not cover them. */
  open: number
  /** ISO. */
  at: string
}

/**
 * The changelog drafts of milestones (BTN-142). The last one of a milestone is kept until the service restarts, and a
 * request while one is being written waits for that one: a draft is an agent's turn, paid and a minute or two long.
 */
export class ChangelogDrafts {
  private readonly written = new Map<string, ChangelogDraft>()
  private readonly writing = new Map<string, Promise<ChangelogDraft>>()

  constructor(private readonly deps: ChangelogDeps) {}

  /** `again` — write a new draft rather than give the last one. */
  draft(project: string, milestone: string, again = false): Promise<ChangelogDraft> {
    const key = JSON.stringify([project, milestone])
    const running = this.writing.get(key)
    if (running !== undefined) return running
    const last = this.written.get(key)
    if (last !== undefined && !again) return Promise.resolve(last)
    const next = this.write(project, milestone).then(
      (draft) => {
        this.writing.delete(key)
        this.written.set(key, draft)
        return draft
      },
      (error: unknown) => {
        this.writing.delete(key)
        throw error
      },
    )
    this.writing.set(key, next)
    return next
  }

  private async write(project: string, milestone: string): Promise<ChangelogDraft> {
    const material = materialOf(milestone, await this.deps.tasks(project, milestone))
    if (material.done.length === 0) throw fail('changelog.empty', { milestone })
    const text = (await this.deps.write(project, changelogPrompt(material))).trim()
    return { project, milestone, text, done: material.done.length, open: material.open, at: this.deps.now().toISOString() }
  }
}
