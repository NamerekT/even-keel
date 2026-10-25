import type { CiJob, CiRun, CiSource } from './model.js'
import type { CiTarget } from './remote.js'

/** How long an answer serves every watch of the repository: below `POLL_MS`, so each poll of a running run still asks. */
export const FRESH_MS = 10_000
/** A repository and token nobody asked about for this long is forgotten. */
const IDLE_MS = 60 * 60_000

interface Answer<T> {
  at: number
  value: Promise<T>
}

interface Entry {
  source: CiSource
  used: number
  runs: Map<string, Answer<CiRun[]>>
  jobs: Map<string, Answer<CiJob[]>>
}

/**
 * One poll of a CI's API per repository and token (BTN-289): projects in separate clones of one remote each keep their
 * own watch — their pushes and the tasks of a run are read in their clone — but their sources ask the API once and
 * share the answer for `FRESH_MS`, a failure too. Projects whose tokens differ poll apart: a token decides whether the
 * CI is seen at all (`CiWatch.hidden`).
 */
export class SharedSources {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly make: (target: CiTarget, token: string | null) => CiSource | null,
    private readonly now: () => number = Date.now,
  ) {}

  of(target: CiTarget, token: string | null): CiSource | null {
    if (token === null) return null
    const key = JSON.stringify([target.kind, target.web, target.owner, target.repo, token])
    const entry = this.entryOf(key, target, token)
    if (entry === null) return null
    const source: CiSource = {
      runs: (limit, branch) => {
        const current = this.entryOf(key, target, token)!
        return this.answer(current.runs, JSON.stringify([limit, branch]), () => current.source.runs(limit, branch)).then((runs) => [...runs])
      },
      jobs: (run) => {
        const current = this.entryOf(key, target, token)!
        return this.answer(current.jobs, `${run.id}:${run.status}`, () => current.source.jobs(run)).then((jobs) => [...jobs])
      },
    }
    if (entry.source.log !== undefined) source.log = (job) => this.entryOf(key, target, token)!.source.log!(job)
    return source
  }

  /** The entry of the key, made anew once forgotten, so a watch holding an old source still shares the poll. */
  private entryOf(key: string, target: CiTarget, token: string): Entry | null {
    const now = this.now()
    for (const [each, entry] of this.entries) if (each !== key && now - entry.used >= IDLE_MS) this.entries.delete(each)
    let entry = this.entries.get(key)
    if (entry === undefined) {
      const source = this.make(target, token)
      if (source === null) return null
      entry = { source, used: now, runs: new Map(), jobs: new Map() }
      this.entries.set(key, entry)
    }
    entry.used = now
    return entry
  }

  private answer<K, T>(answers: Map<K, Answer<T>>, key: K, ask: () => Promise<T>): Promise<T> {
    const now = this.now()
    for (const [each, answer] of answers) if (now - answer.at >= FRESH_MS) answers.delete(each)
    const known = answers.get(key)
    if (known !== undefined) return known.value
    const value = ask()
    const answer = { at: now, value }
    answers.set(key, answer)
    const settled = () => {
      answer.at = this.now()
    }
    value.then(settled, settled)
    return value
  }
}
