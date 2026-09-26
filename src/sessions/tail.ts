import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentEntry } from './agents.js'
import { projectDirName } from './paths.js'
import { TranscriptFold } from './transcript.js'

const NEWLINE = 0x0a

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
  private carry = Buffer.alloc(0)

  constructor(
    private readonly projectsDir: string,
    private agent: AgentEntry,
  ) {}

  follow(agent: AgentEntry): void {
    this.agent = agent
  }

  async read(): Promise<void> {
    const found = await this.find()
    if (found === undefined) return
    if (found.ino !== this.ino || found.size < this.offset) this.restart(found)
    this.file = found.file
    if (found.size === this.offset) return

    const handle = await open(found.file, 'r')
    try {
      const chunk = Buffer.alloc(found.size - this.offset)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, this.offset)
      this.offset += bytesRead
      const data = Buffer.concat([this.carry, chunk.subarray(0, bytesRead)])
      const end = data.lastIndexOf(NEWLINE)
      this.carry = Buffer.from(data.subarray(end + 1))
      if (end < 0) return
      for (const line of data.subarray(0, end).toString('utf8').split('\n')) this.fold.push(line)
    } finally {
      await handle.close()
    }
  }

  private restart(found: Found): void {
    this.fold = new TranscriptFold()
    this.file = found.file
    this.ino = found.ino
    this.offset = 0
    this.carry = Buffer.alloc(0)
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
