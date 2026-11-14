import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import type { Stats } from 'node:fs'
import type { NoteRefusal } from '../notice/en-review.js'
import { fail, NoticeError } from '../notice/notice.js'
import { isInside } from '../paths.js'

const NOTE_LIMIT = 64 * 1024

function secret(path: string): boolean {
  const parts = path.split(/[\\/]/).map((part) => part.toLowerCase())
  const name = parts.at(-1)!
  return parts.includes('.git') || ((name === '.env' || name.startsWith('.env.')) && name !== '.env.example')
}

/** Read a PR description only from the task folder, resolving links and bounding even a file that grows. */
export async function readPullNote(folder: string, path: string): Promise<string> {
  const refused = (reason: NoteRefusal) => fail('review.noNote', { path, reason, limit: NOTE_LIMIT })
  const check = (info: Stats) => {
    if (!info.isFile()) throw refused('notFile')
    if (info.size > NOTE_LIMIT) throw refused('tooLarge')
  }
  try {
    const root = await realpath(folder)
    const real = await realpath(path)
    const inner = relative(root, real)
    if (!isInside(real, root) || inner.startsWith(`..${sep}`) || isAbsolute(inner)) throw refused('outside')
    if (secret(relative(root, path)) || secret(inner)) throw refused('secret')
    check(await stat(real))
    const file = await open(real, 'r')
    try {
      check(await file.stat())
      const buffer = Buffer.alloc(NOTE_LIMIT + 1)
      let total = 0
      while (total < buffer.length) {
        const { bytesRead } = await file.read(buffer, total, buffer.length - total, total)
        if (bytesRead === 0) break
        total += bytesRead
      }
      if (total > NOTE_LIMIT) throw refused('tooLarge')
      return buffer.subarray(0, total).toString('utf8')
    } finally {
      await file.close()
    }
  } catch (error) {
    if (error instanceof NoticeError) throw error
    const code = (error as NodeJS.ErrnoException).code
    throw refused(code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : code === 'EISDIR' ? 'notFile' : 'unreadable')
  }
}
