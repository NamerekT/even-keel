import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentEntry } from './agents.js'
import { readLines } from './lines.js'
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

  constructor(
    private readonly projectsDir: string,
    private agent: AgentEntry,
  ) {}

  get path(): string | undefined {
    return this.file
  }

  summary(): TranscriptSummary {
    return this.fold.summary()
  }

  follow(agent: AgentEntry): void {
    this.agent = agent
  }

  async read(): Promise<void> {
    const found = await this.find()
    if (found === undefined) return
    if (found.ino !== this.ino || found.size < this.offset) this.restart(found)
    this.file = found.file
    const { lines, next } = await readLines(found.file, this.offset, found.size)
    this.offset = next
    for (const line of lines) this.fold.push(line)
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
