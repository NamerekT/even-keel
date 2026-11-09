import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { sniffedType } from '../builtin/files.js'
import { megabytes } from '../notice/en.js'
import { EditRefused, type TaskUpload } from '../tracker/editor.js'
import { isInside } from '../paths.js'

/** The most files one call attaches. */
export const UPLOADS_PER_CALL = 10

const TYPES: Readonly<Record<string, string>> = {
  '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain', '.log': 'text/plain', '.csv': 'text/csv',
  '.json': 'application/json', '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif',
}

/** A `.env` file (not its `.env.example`) or anything under `.git`: these never go to a tracker, which may be public. */
function secret(inner: string): boolean {
  const parts = inner.split(/[\\/]/).map((each) => each.toLowerCase())
  const name = parts.at(-1)!
  return parts.includes('.git') || ((name === '.env' || name.startsWith('.env.')) && name !== '.env.example')
}

const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${bytes} B` : `${megabytes(bytes)} MB`)

/**
 * The files the agent named, read by the service for a tracker (BTN-895): only files of the session's working folder,
 * by a path relative to it or absolute, with links resolved, so neither `..` nor a symbolic link or junction reaches
 * past it; a `.env` file and `.git` are refused inside it too. `limit` — the attachment size limit, bytes.
 */
export async function readUploads(paths: readonly string[], folder: string, limit: number): Promise<TaskUpload[]> {
  if (paths.length > UPLOADS_PER_CALL) throw new EditRefused(`attach at most ${UPLOADS_PER_CALL} files in one call`)
  const root = await realpath(folder).catch(() => {
    throw new EditRefused(`the working folder ${folder} is not there; nothing can be attached`)
  })
  const files: TaskUpload[] = []
  for (const named of paths) {
    const path = named.trim()
    if (path === '') throw new EditRefused('"attach" has an empty path')
    const full = resolve(root, path)
    const real = await realpath(full).catch(() => null)
    if (real === null) throw new EditRefused(`"${path}": no such file in the working folder ${root}`)
    const inner = relative(root, real)
    if (!isInside(real, root) || inner.startsWith(`..${sep}`) || isAbsolute(inner)) {
      throw new EditRefused(`"${path}" is outside the working folder ${root}; only its files, its .temp/ too, can be attached`)
    }
    if (secret(inner)) throw new EditRefused(`"${path}" is not attached: .env files and .git never leave the machine`)
    const info = await stat(real)
    if (!info.isFile()) throw new EditRefused(`"${path}" is not a file`)
    if (info.size > limit) throw new EditRefused(`"${path}" is ${sizeText(info.size)}, more than the attachment limit of ${sizeText(limit)}`)
    const bytes = await readFile(real)
    const sniffed = sniffedType(bytes.subarray(0, 12))
    const type = sniffed !== 'application/octet-stream' ? sniffed : (TYPES[extname(real).toLowerCase()] ?? sniffed)
    files.push({ name: basename(real), type, bytes })
  }
  return files
}
