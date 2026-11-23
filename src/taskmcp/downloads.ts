import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { megabytes } from '../notice/en.js'
import type { TaskAttachment } from '../tracker/card.js'
import type { TaskBrief, TaskFile } from '../tracker/source.js'

/** Where `task_read` puts a task's files, inside the session's working folder (BTN-923). */
export const DOWNLOADS = join('.temp', 'task-files')

/** What the downloads need of a tracker: its optional `file`. */
export interface FileSource {
  file?(id: string, file: string): Promise<TaskFile | null>
}

/**
 * Where a task's downloaded files go: the session's working folder (`folderSink`) or, in the hub, the answer that the
 * machine's gateway writes into that folder (BTN-990). `name` is already a safe file name.
 */
export interface FileSink {
  /** The path of a copy of this size already there; `null` — none, or not known. */
  existing(key: string, name: string, size: number): Promise<string | null>
  /** Keeps the file and gives what its line names: its path. */
  put(key: string, name: string, bytes: Uint8Array): Promise<string>
}

/** A file got larger than the limit while it streamed. */
class TooLarge extends Error {}

/**
 * The `## Attachments` lines of `task_read` (BTN-923): a file the tracker serves (`url: null`) downloaded into
 * `<folder>/.temp/task-files/<KEY>/` and named by that copy's path; a built-in file copied there from the store, so a
 * session never holds the store's own bytes (BTN-1538), by its store path only with no folder; a public one by its
 * `url`. A file over `limit` bytes, one with no folder to go to and one that failed to download get a line that says so,
 * never an error: the card is the answer. A file only outsiders' comments carry (BTN-1122) is left out altogether.
 */
export async function attachmentLines(key: string, all: readonly TaskAttachment[], source: FileSource, sink: FileSink | null, limit: number): Promise<string[]> {
  const attachments = all.filter((each) => each.outsider !== true)
  const named = copyNames(attachments.map((each) => ({ name: each.name, id: each.file })))
  return Promise.all(
    attachments.map(async (each, index) => {
      const line = (where: string) => `- ${each.name}${each.size > 0 ? ` (${sizeText(each.size)})` : ''} — ${where}`
      const name = named[index]!
      if (each.path !== undefined) {
        if (each.missing) return line('file missing')
        if (sink === null) return line(each.path)
        // Past the limit too: the bytes are on this disk already, and the limit stands for a tracker's download.
        return line(await storeCopy(key, name, each.path, sink).catch(() => 'file unavailable'))
      }
      if (each.url !== null) return line(each.url)
      if (each.size > limit) return line('too large')
      if (source.file === undefined || sink === null) return line('not downloaded')
      try {
        const there = each.size > 0 ? await sink.existing(key, name, each.size) : null
        if (there !== null) return line(there)
        const got = await source.file(key, each.file)
        if (got === null) return line('file unavailable')
        if (got.size !== null && got.size > limit) {
          // An unread stream would hold the tracker's connection open.
          await got.body[Symbol.asyncIterator]().return?.()
          return line('too large')
        }
        return line(await sink.put(key, name, await bytesOf(got.body, limit)))
      } catch (error) {
        return line(error instanceof TooLarge ? 'too large' : 'file unavailable')
      }
    }),
  )
}

/**
 * The copies' names of a task's files: a file's safe name, or with the prefix of its id (a URL's hash, a built-in
 * file's sha256) where two files share one.
 */
function copyNames(files: readonly { name: string; id: string }[]): string[] {
  const counts = new Map<string, number>()
  for (const each of files) counts.set(safeName(each.name), (counts.get(safeName(each.name)) ?? 0) + 1)
  return files.map((each) => {
    const prefix = /^https?:\/\//.test(each.id) ? createHash('sha256').update(each.id).digest('hex').slice(0, 8) : safeName(each.id).slice(0, 8)
    return counts.get(safeName(each.name))! > 1 ? `${prefix}-${safeName(each.name)}` : safeName(each.name)
  })
}

/** The copy of a built-in file's bytes `path` in the sink; a copy of the same size already there is taken as it is. */
async function storeCopy(key: string, name: string, path: string, sink: FileSink): Promise<string> {
  const size = (await stat(path)).size
  return (await sink.existing(key, name, size)) ?? sink.put(key, name, await readFile(path))
}

/**
 * The prompt with each of the brief's built-in files (the task's and its parents') named by its copy in the session's
 * `folder` instead of its path in the store (BTN-1538): the copies are the files `task_read` gives too. A file that
 * cannot be copied, such as one of a hub on another machine, keeps its line as it was.
 */
export async function withBriefCopies(prompt: string, task: string, brief: TaskBrief | undefined, folder: string): Promise<string> {
  if (brief === undefined) return prompt
  const sink = folderSink(folder)
  const levels = [{ key: task, files: brief.files ?? [] }, ...(brief.ancestors ?? []).map((each) => ({ key: each.id, files: each.files ?? [] }))]
  let copied = prompt
  for (const { key, files } of levels) {
    const names = copyNames(files.map((each) => ({ name: each.name, id: basename(each.path) })))
    for (const [index, file] of files.entries()) {
      const copy = await storeCopy(key, names[index]!, file.path, sink).catch(() => null)
      if (copy !== null) copied = copied.split(file.path).join(copy)
    }
  }
  return copied
}

/** A tracker answered with no bytes: Linear's storage does so for a while right after an upload (BTN-1201). */
class Empty extends Error {}

/**
 * The whole stream, no more than `limit` bytes. An empty body is no copy: it is a storage not ready yet far more often
 * than a file of zero bytes.
 */
async function bytesOf(body: AsyncIterable<Uint8Array>, limit: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let read = 0
  for await (const chunk of body) {
    read += chunk.byteLength
    if (read > limit) throw new TooLarge()
    chunks.push(chunk)
  }
  if (read === 0) throw new Empty()
  return Buffer.concat(chunks)
}

/** The task's files in `<folder>/.temp/task-files/<KEY>/`, each written beside its place and renamed in, so a half-written file is never taken for a copy. */
export function folderSink(folder: string): FileSink {
  const pathOf = (key: string, name: string) => join(folder, DOWNLOADS, safeName(key), safeName(name))
  return {
    existing: async (key, name, size) => {
      const target = pathOf(key, name)
      return (await stat(target).catch(() => null))?.size === size ? target : null
    },
    put: async (key, name, bytes) => {
      const target = pathOf(key, name)
      if ((await stat(target).catch(() => null))?.size === bytes.byteLength) return target
      await mkdir(join(folder, DOWNLOADS, safeName(key)), { recursive: true })
      const part = `${target}.part`
      try {
        await writeFile(part, bytes)
        await rename(part, target)
      } catch (error) {
        await rm(part, { force: true })
        throw error
      }
      return target
    },
  }
}

/**
 * The copies a task's folders under `<folder>/.temp/task-files/` hold, its key matched in any case (BTN-1237): by the
 * folder's name, then the file's name, its size. A `.part` file is no copy.
 */
export async function copiesOf(folder: string, key: string): Promise<Record<string, Record<string, number>>> {
  const wanted = safeName(key.trim()).toLowerCase()
  const root = join(folder, DOWNLOADS)
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((each) => each.isDirectory() && each.name.toLowerCase() === wanted)
  const copies: Record<string, Record<string, number>> = {}
  for (const dir of dirs) {
    const files: Record<string, number> = {}
    for (const each of await readdir(join(root, dir.name), { withFileTypes: true }).catch(() => [])) {
      if (!each.isFile() || each.name.endsWith('.part')) continue
      const size = (await stat(join(root, dir.name, each.name)).catch(() => null))?.size
      if (size !== undefined) files[each.name] = size
    }
    copies[dir.name] = files
  }
  return copies
}

/** A file name that stays one name on every system: no separators, no characters Windows refuses, never `.` or `..`. */
export function safeName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim()
  return clean === '' || /^\.+$/.test(clean) ? 'file' : clean
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${megabytes(bytes)} MB`
}
