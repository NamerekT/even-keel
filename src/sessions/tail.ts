import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentEntry } from './agents.js'
import { lineSlices } from './lines.js'
import { projectDirName } from './paths.js'
import { TranscriptFold, type TranscriptSummary } from './transcript.js'

interface Found {
  file: string
  ino: number
  size: number
}

export class TranscriptTail {
  fold = new TranscriptFold()
  private file: string | undefined
  private ino: number | undefined
  private offset = 0
  /** The summary from before a read in progress: a catch-up yields between slices and must not show a half-folded transcript. */
  private held: TranscriptSummary | undefined

  constructor(
    private readonly projectsDir: string,
    private agent: AgentEntry,
  ) {}

  get path(): string | undefined {
    return this.file
  }

  /** Checks the same locations as a read, without loading the transcript. */
  async exists(): Promise<boolean> {
    return (await this.find()) !== undefined
  }

  summary(): TranscriptSummary {
    return this.held ?? this.fold.summary()
  }

  follow(agent: AgentEntry): void {
    this.agent = agent
  }

  async read(): Promise<void> {
    const found = await this.find()
    if (found === undefined) return
    if (found.ino === this.ino && found.size === this.offset) {
      this.file = found.file
      return
    }
    this.held = this.fold.summary()
    try {
      if (found.ino !== this.ino || found.size < this.offset) this.restart(found)
      this.file = found.file
      for await (const { lines, next } of lineSlices(found.file, this.offset, found.size)) {
        for (const line of lines) this.fold.push(line)
        this.offset = next
      }
    } finally {
      this.held = undefined
    }
  }

  private restart(found: Found): void {
    this.fold = new TranscriptFold()
    this.file = found.file
    this.ino = found.ino
    this.offset = 0
  }

  private async find(): Promise<Found | undefined> {
    const name = `${this.agent.sessionId}.jsonl`
    const expected = join(this.projectsDir, projectDirName(this.agent.cwd), name)
    const direct = (await probe(expected)) ?? (this.file === undefined ? undefined : await probe(this.file))
    if (direct !== undefined) return direct
    for (const dir of await readdir(this.projectsDir).catch(() => [])) {
      const found = await probe(join(this.projectsDir, dir, name))
      if (found !== undefined) return found
    }
    return undefined
  }
}

async function probe(file: string): Promise<Found | undefined> {
  try {
    const info = await stat(file)
    return info.isFile() ? { file, ino: info.ino, size: info.size } : undefined
  } catch {
    return undefined
  }
}
