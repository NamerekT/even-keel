import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from '../storage/database.js'
import { fileHash, indexLine, memoryFile, parseMemoryFile, type MemoryRecord } from './record.js'
import { dropMemoryFile, markMirrored, memoryRecords, takeMemoryFile } from './store.js'

/** The index of the hub's memory folder that sessions started by hand read; never a record itself. */
export const MEMORY_INDEX = 'MEMORY.md'

export interface MirrorDeps {
  db: Db
  /** The project's memory folder on the hub (`sharedMemory`); `null` — none to mirror (a project the hub does not know). */
  folderOf(project: string): string | null
  now(): Date
  log(line: string): void
}

/**
 * The hub's memory folder and the records, both ways (BTN-1029): sessions started by hand on the hub keep the CLI's
 * file memory, chain sessions use the records. `pull` takes what changed in the folder since it was last mirrored
 * (a hand edit wins and is a new version, a file gone deletes its record); `push` writes a record a session changed
 * back into its file and the folder's `MEMORY.md`. One project's mirror runs one step at a time.
 */
export class MemoryMirror {
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: MirrorDeps) {}

  pull(project: string): Promise<void> {
    return this.queued(project, () => this.pullNow(project))
  }

  /** The index lines of the project's live records for a chain session's prompt, the folder taken in first. */
  async index(project: string): Promise<string[]> {
    await this.pull(project)
    return (await memoryRecords(this.deps.db, project)).map(indexLine)
  }

  /** `before` — the record before the change: the index line's text changes only with the description. */
  push(project: string, record: MemoryRecord, before?: MemoryRecord): Promise<void> {
    return this.queued(project, () => this.pushNow(project, record, before))
  }

  private queued<T>(project: string, step: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(project) ?? Promise.resolve()).catch(() => {}).then(step)
    this.queues.set(project, run)
    return run
  }

  private async pullNow(project: string): Promise<void> {
    const folder = this.deps.folderOf(project)
    if (folder === null || !existsSync(folder)) return
    const files = readdirSync(folder).filter((name) => name.endsWith('.md') && name !== MEMORY_INDEX && isFile(join(folder, name)))
    const records = await memoryRecords(this.deps.db, project, true)
    const byFile = new Map(records.flatMap((record) => (record.file === null ? [] : [[record.file, record] as const])))
    const at = this.deps.now().toISOString()
    for (const file of files) {
      const text = readFileSync(join(folder, file), 'utf8')
      const hash = fileHash(text)
      const known = byFile.get(file)
      if (known !== undefined && known.fileHash === hash) {
        // Deleted by a session, but the file was not removed then: remove it now.
        if (known.deleted) await this.pushNow(project, known)
        continue
      }
      const fact = parseMemoryFile(text, file.slice(0, -'.md'.length))
      if (known !== undefined && !known.deleted && known.name !== fact.name) await dropMemoryFile(this.deps.db, project, known.name, at)
      const owner = records.find((each) => each.name === fact.name && !each.deleted && each.file !== null && each.file !== file && files.includes(each.file))
      const taken = await takeMemoryFile(this.deps.db, project, owner === undefined ? fact : { ...fact, name: file.slice(0, -'.md'.length) }, file, hash, at)
      this.deps.log(`memory: ${project} took ${file} from the hub's folder as ${taken.name} v${taken.version}`)
    }
    for (const record of records) {
      if (record.deleted || record.file === null || files.includes(record.file)) continue
      if (record.fileHash !== null) {
        await dropMemoryFile(this.deps.db, project, record.name, at)
        this.deps.log(`memory: ${project} ${record.file} left the hub's folder: ${record.name} is deleted`)
      }
    }
    // A session's write the folder missed (the hub stopped between the two): mirrored now.
    for (const record of await memoryRecords(this.deps.db, project)) {
      if (record.file === null) await this.pushNow(project, record)
    }
  }

  private async pushNow(project: string, record: MemoryRecord, before?: MemoryRecord): Promise<void> {
    const folder = this.deps.folderOf(project)
    if (folder === null) return
    if (record.deleted) {
      if (record.file !== null) {
        try {
          unlinkSync(join(folder, record.file))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        editIndex(folder, record.file, null)
      }
      await markMirrored(this.deps.db, project, record.name, record.version, null, null)
      return
    }
    mkdirSync(folder, { recursive: true })
    const file = record.file ?? freeFile(folder, record.name)
    const text = memoryFile(record)
    writeFileSync(join(folder, file), text)
    await markMirrored(this.deps.db, project, record.name, record.version, file, fileHash(text))
    const described = before === undefined || record.file === null || before.description !== record.description
    editIndex(folder, file, described ? record : undefined)
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function freeFile(folder: string, name: string): string {
  for (let n = 1; ; n++) {
    const file = n === 1 ? `${name}.md` : `${name}-${n}.md`
    if (!existsSync(join(folder, file))) return file
  }
}

/**
 * The line of `file` in the folder's `MEMORY.md`: `null` removes it, a record adds it or sets its text after the
 * dash to the description, `undefined` leaves a line there as it is (its title and hook are a person's).
 */
function editIndex(folder: string, file: string, record: MemoryRecord | null | undefined): void {
  const path = join(folder, MEMORY_INDEX)
  const text = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : ''
  const lines = text === '' ? [] : text.replace(/\n+$/, '').split('\n')
  const link = `](${file})`
  const at = lines.findIndex((line) => line.includes(link))
  if (record === null) {
    if (at === -1) return
    lines.splice(at, 1)
  } else if (at === -1) {
    lines.push(`- [${record?.name ?? file}](${file})${record === undefined || record.description === '' ? '' : ` — ${record.description}`}`)
  } else if (record !== undefined) {
    const head = lines[at]!.slice(0, lines[at]!.indexOf(link) + link.length)
    lines[at] = record.description === '' ? head : `${head} — ${record.description}`
  } else return
  writeFileSync(path, lines.length === 0 ? '' : `${lines.join('\n')}\n`)
}
