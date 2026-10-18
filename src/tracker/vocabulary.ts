import type { TrackerVocabulary } from './source.js'

/** A tracker's statuses and labels change rarely: the settings panel may ask on every opening. */
const KEEP_MS = 5 * 60_000

/**
 * The tracker's vocabulary of each project, read at most once per `keepMs`. A failed read, or a project whose tracker
 * is off or has no `vocabulary`, is not kept: the next opening asks again.
 */
export class Vocabularies {
  private readonly kept = new Map<string, { at: number; value: Promise<TrackerVocabulary | undefined> }>()

  constructor(
    private readonly read: (project: string) => Promise<TrackerVocabulary | undefined>,
    private readonly now: () => number = Date.now,
    private readonly keepMs = KEEP_MS,
  ) {}

  get(project: string): Promise<TrackerVocabulary | undefined> {
    const entry = this.kept.get(project)
    if (entry !== undefined && this.now() - entry.at < this.keepMs) return entry.value
    const value = this.read(project)
    this.kept.set(project, { at: this.now(), value })
    const forget = () => {
      if (this.kept.get(project)?.value === value) this.kept.delete(project)
    }
    value.then((found) => found === undefined && forget(), forget)
    return value
  }
}
