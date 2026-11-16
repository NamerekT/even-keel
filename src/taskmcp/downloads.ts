import { createHash } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { megabytes } from '../notice/en.js'
import type { TaskAttachment } from '../tracker/card.js'
import type { TaskFile } from '../tracker/source.js'

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
 * The `## Attachments` lines of `task_read` (BTN-923): a built-in file by its own path; a file the tracker serves
 * (`url: null`) downloaded into `<folder>/.temp/task-files/<KEY>/` and named by that copy's path; a public one by its
 * `url`. A file over `limit` bytes, one with no folder to go to and one that failed to download get a line that says so,
 * never an error: the card is the answer. A file only outsiders' comments carry (BTN-1122) is left out altogether.
 */
export async function attachmentLines(key: string, all: readonly TaskAttachment[], source: FileSource, sink: FileSink | null, limit: number): Promise<string[]> {
  const attachments = all.filter((each) => each.outsider !== true)
  const counts = new Map<string, number>()
  for (const each of attachments) counts.set(safeName(each.name), (counts.get(safeName(each.name)) ?? 0) + 1)
  return Promise.all(
    attachments.map(async (each) => {
      const line = (where: string) => `- ${each.name}${each.size > 0 ? ` (${sizeText(each.size)})` : ''} — ${where}`
      if (each.path !== undefined) return line(each.missing ? 'file missing' : each.path)
      if (each.url !== null) return line(each.url)
      if (each.size > limit) return line('too large')
      if (source.file === undefined || sink === null) return line('not downloaded')
      const prefix = /^https?:\/\//.test(each.file) ? createHash('sha256').update(each.file).digest('hex').slice(0, 8) : safeName(each.file).slice(0, 8)
      const name = counts.get(safeName(each.name))! > 1 ? `${prefix}-${safeName(each.name)}` : safeName(each.name)
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
