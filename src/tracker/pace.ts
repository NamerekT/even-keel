import type { TaskEditor } from './editor.js'

/** At most `count` writes in any `ms` milliseconds. */
export interface WriteWindow {
  count: number
  ms: number
}

export interface PaceClock {
  now(): number
  sleep(ms: number): Promise<void>
}

/** A timer that does not keep the service from stopping. */
export const realClock: PaceClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
}

/**
 * GitHub's secondary limits allow 80 content-creating requests a minute and 500 an hour; the copy keeps below both, as
 * one create may make more than one request (its labels, its status) and the token may write elsewhere meanwhile.
 */
export const GITHUB_WRITES: readonly WriteWindow[] = [
  { count: 60, ms: 60_000 },
  { count: 400, ms: 3_600_000 },
]

/** The writes of one run, held so that none of the windows gets more than its count (BTN-1190). */
export class WritePace {
  private readonly stamps: number[] = []
  private readonly keep: number

  constructor(
    private readonly windows: readonly WriteWindow[],
    private readonly clock: PaceClock = realClock,
  ) {
    this.keep = Math.max(0, ...windows.map((each) => each.count))
  }

  /** Waits until one more write fits every window and counts it. */
  async next(): Promise<void> {
    for (;;) {
      const now = this.clock.now()
      const wait = Math.max(0, ...this.windows.map((window) => this.waitFor(window, now)))
      if (wait <= 0) break
      await this.clock.sleep(wait)
    }
    if (this.keep === 0) return
    this.stamps.push(this.clock.now())
    if (this.stamps.length > this.keep) this.stamps.splice(0, this.stamps.length - this.keep)
  }

  private waitFor({ count, ms }: WriteWindow, now: number): number {
    const inside = this.stamps.filter((at) => at > now - ms)
    return inside.length < count ? 0 : inside[inside.length - count]! + ms - now
  }
}

/** The editor whose every write waits for `pace` first; the reads go as they are. */
export function pacedEditor(editor: TaskEditor, pace: WritePace): TaskEditor {
  const held =
    <A extends unknown[], R>(write: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await pace.next()
      return write(...args)
    }
  const { files, estimate, noteRun } = editor
  return {
    ...editor,
    list: (project) => editor.list(project),
    revision: (id) => editor.revision(id),
    create: held((project, draft, notes, marker) => editor.create(project, draft, notes, marker)),
    set: held((id, field) => editor.set(id, field)),
    describe: held((id, text, rev, notes) => editor.describe(id, text, rev, notes)),
    patch: held((id, patches, append, notes) => editor.patch(id, patches, append, notes)),
    link: held((id, other, link, on) => editor.link(id, other, link, on)),
    relabel: held((id, change) => editor.relabel(id, change)),
    comment: held((id, body, model, notes) => editor.comment(id, body, model, notes)),
    ...(estimate === undefined ? {} : { estimate: held((id: string, minutes: number) => estimate.call(editor, id, minutes)) }),
    ...(noteRun === undefined ? {} : { noteRun: held((...args: Parameters<typeof noteRun>) => noteRun.apply(editor, args)) }),
    ...(files === undefined
      ? {}
      : {
          files: {
            attach: held((id, uploads, notes) => files.attach(id, uploads, notes)),
            comment: held((id, body, uploads, model, notes) => files.comment(id, body, uploads, model, notes)),
          },
        }),
  }
}
