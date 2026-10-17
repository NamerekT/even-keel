import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../account/homes.js'

const TRANSCRIPT = /^([0-9a-f][0-9a-f-]{7,63})\.jsonl$/i

export interface OwnersOptions {
  homes: () => AccountHome[]
  /** The sessions whose transcripts a folder holds, by its agent (`Agent.transcripts`). */
  transcripts: (home: AccountHome) => Promise<string[]>
  /** How long after a scan a session with no transcript found does not trigger another one. */
  rescanMs: number
  onChange: () => void
  onError: (error: unknown) => void
  now?: () => number
}

/** Which account folder holds a session's transcript: that is the account it ran on. */
export class TranscriptOwners {
  private owners = new Map<string, string>()
  private scannedAt = -Infinity
  private scanning: Promise<void> | null = null

  constructor(private readonly options: OwnersOptions) {}

  /** The folder key, or `undefined` while it is not known; a miss schedules a rescan at most once per `rescanMs`. */
  of(sessionId: string): string | undefined {
    const key = this.owners.get(sessionId)
    if (key === undefined && this.now() - this.scannedAt >= this.options.rescanMs) void this.scan()
    return key
  }

  scan(): Promise<void> {
    this.scanning ??= this.read()
      .then((found) => {
        const changed = found.size !== this.owners.size || [...found].some(([id, key]) => this.owners.get(id) !== key)
        this.owners = found
        if (changed) this.options.onChange()
      })
      .catch((error: unknown) => this.options.onError(error))
      .finally(() => {
        this.scannedAt = this.now()
        this.scanning = null
      })
    return this.scanning
  }

  private async read(): Promise<Map<string, string>> {
    const found = new Map<string, string>()
    for (const home of this.options.homes()) {
      for (const id of await this.options.transcripts(home)) if (!found.has(id)) found.set(id, home.key)
    }
    return found
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

/** The session ids of Claude Code transcripts under a `projects` folder (`projects/<dir>/<id>.jsonl`). */
export async function transcriptIds(projects: string): Promise<string[]> {
  const ids: string[] = []
  for (const dir of await readdir(projects).catch(() => [])) {
    for (const name of await readdir(join(projects, dir)).catch(() => [])) {
      const id = TRANSCRIPT.exec(name)?.[1]
      if (id !== undefined) ids.push(id)
    }
  }
  return ids
}
