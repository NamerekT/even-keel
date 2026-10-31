import type { TrackerVocabulary } from './source.js'

/** A tracker's statuses and labels change rarely: the settings panel may ask on every opening. */
const KEEP_MS = 5 * 60_000

/** What a tracker answers for a key, read at most once per `keepMs`; a failed read or `undefined` is not kept. */
export class KeptReads<T> {
  private readonly kept = new Map<string, { at: number; value: Promise<T | undefined> }>()

  constructor(
    private readonly read: (key: string) => Promise<T | undefined>,
    private readonly now: () => number = Date.now,
    private readonly keepMs = KEEP_MS,
  ) {}

  get(project: string): Promise<T | undefined> {
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

/**
 * The tracker's vocabulary of each project. A project whose tracker is off or has no `vocabulary` is not kept: the next
 * opening asks again.
 */
export class Vocabularies extends KeptReads<TrackerVocabulary> {}
