import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, open, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fail } from '../notice/notice.js'
import { databaseDirOf, filesDirOf } from '../storage/owner.js'
import type { TaskFile } from '../tracker/source.js'
import type { BuiltinFile, BuiltinStore, TaskKey } from './store.js'

/** The folder of the attachments' bytes of the state folder's database (BTN-773). */
export const attachmentsDirOf = (stateDir: string) => filesDirOf(databaseDirOf(stateDir))

/** The address the page and a description reach an attachment's bytes by. */
export const fileUrl = (task: string, sha256: string) => `/api/tasks/${encodeURIComponent(task)}/files/${sha256}`

/** How long bytes no record points at stay, so that an undone edit of a description shows its picture again. */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000

const SHA = /^[0-9a-f]{64}$/
const UPLOAD = /^\.upload-.*\.tmp$/

/** An attachment with where its bytes are; `missing` — the record outlived its file. */
export interface ListedFile extends BuiltinFile {
  path: string
  missing: boolean
}

export interface NewFile {
  name: string
  type: string
  bytes: Uint8Array
}

/**
 * The attachments of the built-in tracker's tasks: a record in the database, the bytes `files/<sha256>`, one copy for
 * the same bytes. The file is written before its record, so a crash between the two leaves bytes the sweep takes.
 */
export class BuiltinFiles {
  constructor(
    private readonly store: BuiltinStore,
    readonly dir: string,
    private readonly log: (line: string) => void = (line) => console.warn(line),
  ) {}

  async add(key: TaskKey, file: NewFile): Promise<BuiltinFile> {
    const sha256 = createHash('sha256').update(file.bytes).digest('hex')
    await this.write(sha256, file.bytes)
    return this.store.addFile(key, { name: file.name, type: file.type, size: file.bytes.length, sha256 })
  }

  remove(key: TaskKey, id: string): Promise<boolean> {
    return this.store.removeFile(key, id)
  }

  async list(key: TaskKey, name = `${key.project}-${key.number}`): Promise<ListedFile[]> {
    return (await this.store.files(key)).map((file) => {
      const path = join(this.dir, file.sha256)
      const missing = !existsSync(path)
      if (missing) this.log(`builtin: ${name}: the attachment ${file.name} has no file ${file.sha256}`)
      return { ...file, path, missing }
    })
  }

  /**
   * The bytes `sha256` names, with the name the task's record gives them; served whether or not a record is left, so
   * a picture an undo brought back shows until the sweep. Only a raster picture is served as itself.
   */
  async read(key: TaskKey, sha256: string): Promise<TaskFile | undefined> {
    if (!SHA.test(sha256)) return undefined
    const path = join(this.dir, sha256)
    const size = await stat(path).then((info) => info.size, () => undefined)
    if (size === undefined) return undefined
    // Opened only once read: bytes nobody reads hold no handle, which on Windows would keep the sweep from them.
    const body = (async function* () {
      yield* createReadStream(path)
    })()
    return { type: sniffedType(await head(path)), size, name: await this.store.fileName(key, sha256), body }
  }

  /** Removes the bytes no record points at and the half-written uploads, older than `graceMs`; returns their names. */
  async sweep(graceMs = SWEEP_GRACE_MS): Promise<string[]> {
    const names = await readdir(this.dir).catch(() => [] as string[])
    if (names.length === 0) return []
    const kept = await this.store.fileHashes()
    const before = Date.now() - graceMs
    const removed: string[] = []
    for (const name of names) {
      if (!(SHA.test(name) && !kept.has(name)) && !UPLOAD.test(name)) continue
      const path = join(this.dir, name)
      const info = await stat(path).catch(() => undefined)
      if (info === undefined || !info.isFile() || info.mtimeMs > before) continue
      // A file being sent stays locked on Windows: the next sweep takes it.
      if (await rm(path, { force: true }).then(() => true, () => false)) removed.push(name)
    }
    return removed
  }

  /** Writes the bytes unless they are there already; bytes already there are freshened, so the sweep leaves them. */
  private async write(sha256: string, bytes: Uint8Array): Promise<void> {
    const path = join(this.dir, sha256)
    if (existsSync(path)) {
      const now = new Date()
      await utimes(path, now, now)
      return
    }
    await mkdir(this.dir, { recursive: true })
    const temp = join(this.dir, `.upload-${randomUUID()}.tmp`)
    await writeFile(temp, bytes)
    try {
      await rename(temp, path)
    } catch (error) {
      await rm(temp, { force: true })
      if (!existsSync(path)) throw error
    }
  }
}

/** How often the service sweeps the attachments' folder; also once at start. */
export const SWEEP_EVERY_MS = 60 * 60 * 1000

/** The service's sweep: logs what it removed or why it could not. */
export async function sweepAttachments(store: BuiltinStore, dir: string, log: (line: string) => void = (line) => console.log(line)): Promise<void> {
  try {
    const removed = await new BuiltinFiles(store, dir).sweep()
    if (removed.length > 0) log(`builtin: removed ${removed.length} attachment files no task points at: ${removed.join(', ')}`)
  } catch (error) {
    log(`builtin: the sweep of ${dir} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Reads an upload whole, refusing it once it passes `limit` bytes. */
export async function readLimited(body: AsyncIterable<Uint8Array>, limit: number, name: string): Promise<Buffer> {
  const parts: Buffer[] = []
  let size = 0
  for await (const part of body) {
    size += part.length
    if (size > limit) throw fail('builtin.fileTooLarge', { name, limit })
    parts.push(Buffer.from(part))
  }
  return Buffer.concat(parts)
}

/** The type of a raster picture by its first bytes; anything else — bytes to download, never a page or an SVG. */
export function sniffedType(first: Uint8Array): string {
  const bytes = Buffer.from(first)
  const ascii = (from: number, to: number) => bytes.subarray(from, to).toString('latin1')
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 4) === 'GIF8') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(0, 2) === 'BM') return 'image/bmp'
  return 'application/octet-stream'
}

async function head(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(12)
    const { bytesRead } = await handle.read(buffer, 0, 12, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
