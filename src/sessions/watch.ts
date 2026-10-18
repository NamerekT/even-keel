import { watch, type FSWatcher } from 'node:fs'

interface Watched {
  watcher: FSWatcher | null
  askedAt: number
  timer: ReturnType<typeof setTimeout> | undefined
}

/**
 * Watches the transcripts chat windows read and says when one changes, so a window reads it at once rather than at
 * its next poll. A file is watched until no window has asked for it for `idleMs`; a watcher that fails is dropped,
 * and the window's own poll goes on.
 */
export class TranscriptWatch {
  private readonly watched = new Map<string, Watched>()
  private readonly sweep: ReturnType<typeof setInterval>

  constructor(
    private readonly onChange: (sessionId: string) => void,
    private readonly onError: (error: unknown) => void,
    private readonly idleMs = 30_000,
    private readonly settleMs = 100,
  ) {
    this.sweep = setInterval(() => this.dropIdle(), idleMs)
    this.sweep.unref()
  }

  /** A window read session `sessionId`: watch its file, found by `file` when not watched yet. */
  async keep(sessionId: string, file: () => Promise<string | undefined>): Promise<void> {
    const known = this.watched.get(sessionId)
    if (known !== undefined) {
      known.askedAt = Date.now()
      return
    }
    const entry: Watched = { watcher: null, askedAt: Date.now(), timer: undefined }
    this.watched.set(sessionId, entry)
    try {
      const path = await file()
      if (this.watched.get(sessionId) !== entry) return
      if (path === undefined) {
        this.drop(sessionId)
        return
      }
      entry.watcher = watch(path, { persistent: false }, () => this.changed(sessionId, entry))
      entry.watcher.on('error', (error) => {
        this.onError(error)
        this.drop(sessionId)
      })
    } catch (error) {
      this.onError(error)
      this.drop(sessionId)
    }
  }

  close(): void {
    clearInterval(this.sweep)
    for (const id of [...this.watched.keys()]) this.drop(id)
  }

  // A write comes as several events: one call after they settle.
  private changed(sessionId: string, entry: Watched): void {
    if (entry.timer !== undefined) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      this.onChange(sessionId)
    }, this.settleMs)
  }

  private dropIdle(): void {
    const now = Date.now()
    for (const [id, entry] of this.watched) if (now - entry.askedAt > this.idleMs) this.drop(id)
  }

  private drop(sessionId: string): void {
    const entry = this.watched.get(sessionId)
    if (entry === undefined) return
    this.watched.delete(sessionId)
    clearTimeout(entry.timer)
    entry.watcher?.close()
  }
}
