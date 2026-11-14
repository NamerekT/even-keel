import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
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

/** A file got larger than the limit while it streamed. */
class TooLarge extends Error {}

/**
 * The `## Attachments` lines of `task_read` (BTN-923): a built-in file by its own path; a file the tracker serves
 * (`url: null`) downloaded into `<folder>/.temp/task-files/<KEY>/` and named by that copy's path; a public one by its
 * `url`. A file over `limit` bytes, one with no folder to go to and one that failed to download get a line that says so,
 * never an error: the card is the answer. A file only outsiders' comments carry (BTN-1122) is left out altogether.
 */
export async function attachmentLines(key: string, all: readonly TaskAttachment[], source: FileSource, folder: string | null, limit: number): Promise<string[]> {
  const attachments = all.filter((each) => each.outsider !== true)
  const counts = new Map<string, number>()
  for (const each of attachments) counts.set(safeName(each.name), (counts.get(safeName(each.name)) ?? 0) + 1)
  const dir = folder === null ? null : join(folder, DOWNLOADS, safeName(key))
  return Promise.all(
    attachments.map(async (each) => {
      const line = (where: string) => `- ${each.name}${each.size > 0 ? ` (${sizeText(each.size)})` : ''} — ${where}`
      if (each.path !== undefined) return line(each.missing ? 'file missing' : each.path)
      if (each.url !== null) return line(each.url)
      if (each.size > limit) return line('too large')
      if (source.file === undefined || dir === null) return line('not downloaded')
      const prefix = /^https?:\/\//.test(each.file) ? createHash('sha256').update(each.file).digest('hex').slice(0, 8) : safeName(each.file).slice(0, 8)
      const name = counts.get(safeName(each.name))! > 1 ? `${prefix}-${safeName(each.name)}` : safeName(each.name)
      const target = join(dir, name)
      try {
        if (each.size > 0 && (await stat(target).catch(() => null))?.size === each.size) return line(target)
        const got = await source.file(key, each.file)
        if (got === null) return line('file unavailable')
        if (got.size !== null && got.size > limit) {
          // An unread stream would hold the tracker's connection open.
          await got.body[Symbol.asyncIterator]().return?.()
          return line('too large')
        }
        await mkdir(dir, { recursive: true })
        await download(got.body, target, limit)
        return line(target)
      } catch (error) {
        return line(error instanceof TooLarge ? 'too large' : 'file unavailable')
      }
    }),
  )
}

/** Writes the stream beside `target` and renames it in place, so a half-written file is never taken for a copy. */
async function download(body: AsyncIterable<Uint8Array>, target: string, limit: number): Promise<void> {
  const part = `${target}.part`
  const handle = await open(part, 'w')
  try {
    let written = 0
    for await (const chunk of body) {
      written += chunk.byteLength
      if (written > limit) throw new TooLarge()
      await handle.write(chunk)
    }
  } catch (error) {
    await handle.close()
    await rm(part, { force: true })
    throw error
  }
  await handle.close()
  await rename(part, target)
}

/** A file name that stays one name on every system: no separators, no characters Windows refuses, never `.` or `..`. */
function safeName(name: string): string {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim()
  return clean === '' || /^\.+$/.test(clean) ? 'file' : clean
}

function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${megabytes(bytes)} MB`
}
