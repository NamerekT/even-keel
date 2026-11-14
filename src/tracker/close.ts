import type { DoneMove } from '../chain/moves.js'
import { fail, type Notice } from '../notice/notice.js'
import { errorText } from './link.js'

export interface CloseOptions {
  /** Even Keel does not retry the close by itself (a paused chain, a refused button): the notice does not promise it. */
  held?: boolean
  /** The tracker's own error under a `tracker.completeRefused`, for the log. */
  onRefused?: (error: unknown) => void
}

/**
 * Every way Even Keel closes a task — a merge, a merged pull request, a `NO CHANGES:` mark, "Accept as answer" — goes
 * through here (BTN-1163). Throws `statusMove.notDone` without calling the tracker when the rules do not take the chosen
 * status for done.
 */
export function checkDone(task: string, done: DoneMove | undefined, options: CloseOptions = {}): void {
  if (done === undefined || done.fits) return
  throw fail('statusMove.notDone', { task, status: done.status, level: done.level, ...(options.held === true && { held: true as const }) })
}

/**
 * Closes the task into the source's chosen done status (BTN-554), none chosen — the tracker's first. `complete` is the
 * tracker's call with that status; its refusal is thrown as `tracker.completeRefused` naming the status and its level.
 */
export async function closeInto(
  task: string,
  done: DoneMove | undefined,
  complete: (status?: string) => Promise<boolean>,
  options: CloseOptions = {},
): Promise<boolean> {
  checkDone(task, done, options)
  try {
    return await (done === undefined ? complete() : complete(done.status))
  } catch (error) {
    options.onRefused?.(error)
    const named = done === undefined ? {} : { status: done.status, level: done.level }
    throw fail('tracker.completeRefused', { task, ...named, ...(options.held === true && { held: true as const }) }, { detail: errorText(error) })
  }
}

/**
 * The tasks whose pull request is merged and whose close did not go through, by reader (BTN-1163): `MergeCloser`
 * retries them with its own and shows their refusals. Memory only, as the closer's own.
 */
export class PendingCloses {
  private readonly byReader = new Map<string, Map<string, Notice>>()

  note(reader: string, task: string, refusal: Notice): void {
    const tasks = this.byReader.get(reader) ?? new Map<string, Notice>()
    this.byReader.set(reader, tasks)
    tasks.set(task, refusal)
  }

  has(reader: string, task: string): boolean {
    return this.byReader.get(reader)?.has(task) === true
  }

  clear(reader: string, task: string): void {
    this.byReader.get(reader)?.delete(task)
  }

  /** Forgets the reader's tasks outside `held`. */
  keep(reader: string, held: readonly string[]): void {
    const tasks = this.byReader.get(reader)
    if (tasks === undefined) return
    for (const task of tasks.keys()) if (!held.includes(task)) tasks.delete(task)
  }

  failures(reader: string): Notice[] {
    return [...(this.byReader.get(reader)?.values() ?? [])]
  }
}
