import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const INBOX = join('.temp', 'inbox')
const UNZIP_TIMEOUT_MS = 60_000
const NAME_LIMIT = 120
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export interface InboxFile {
  name: string
  data: Uint8Array
}

/**
 * Saves the files of a reply into `.temp/inbox/` of the task's folder and returns their absolute paths.
 * A `.zip` is unpacked into a folder of its name and the archive dropped; one that will not unpack stays as it is.
 * The folder ignores itself, so the files never make the worktree dirty.
 */
export async function saveInbox(workdir: string, files: InboxFile[], unzip = extractZip): Promise<string[]> {
  if (files.length === 0) return []
  const dir = join(workdir, INBOX)
  await mkdir(dir, { recursive: true })
  const ignore = join(dir, '.gitignore')
  if (!existsSync(ignore)) await writeFile(ignore, '*\n')
  const taken = new Set<string>()
  const paths: string[] = []
  for (const file of files) {
    const name = freeName(inboxName(file.name), (candidate) => taken.has(candidate) || existsSync(join(dir, candidate)))
    taken.add(name)
    const path = join(dir, name)
    await writeFile(path, file.data)
    if (extname(name).toLowerCase() !== '.zip') {
      paths.push(path)
      continue
    }
    const folder = freeName(name.slice(0, -'.zip'.length) || 'archive', (candidate) => taken.has(candidate) || existsSync(join(dir, candidate)))
    taken.add(folder)
    try {
      await mkdir(join(dir, folder))
      await unzip(path, join(dir, folder))
      await rm(path)
      paths.push(join(dir, folder))
    } catch {
      await rm(join(dir, folder), { recursive: true, force: true })
      paths.push(path)
    }
  }
  return paths
}

/**
 * The picture `name` among the files a session was sent (paths from its transcript), with its type; only one that lies in
 * an inbox folder, so the page reaches no other file of the machine.
 */
export function inboxImage(sent: string[], name: string): { path: string; type: string } | undefined {
  const type = IMAGE_TYPES[extname(name).toLowerCase()]
  if (type === undefined) return undefined
  const path = sent.find((file) => {
    const parts = file.split(/[\\/]/)
    return parts.at(-1) === name && parts.at(-2) === 'inbox' && parts.at(-3) === '.temp'
  })
  return path === undefined ? undefined : { path, type }
}

/** A file name safe on every system: no folders, no reserved characters, not empty. */
export function inboxName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '')
  if (clean === '') return 'file'
  if (clean.length <= NAME_LIMIT) return clean
  const ext = extname(clean).slice(0, 16)
  return clean.slice(0, NAME_LIMIT - ext.length) + ext
}

/** `name`, or `name (2)`, `name (3)`… before the extension, whichever is free. */
export function freeName(name: string, taken: (name: string) => boolean): string {
  if (!taken(name)) return name
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let number = 2; ; number++) {
    const candidate = `${stem} (${number})${ext}`
    if (!taken(candidate)) return candidate
  }
}

/** `tar` unpacks zip on Windows 10+ and macOS (bsdtar); GNU tar does not, so `unzip` is the fallback. */
async function extractZip(file: string, dir: string): Promise<void> {
  try {
    await run('tar', ['-xf', file, '-C', dir], { timeout: UNZIP_TIMEOUT_MS, windowsHide: true })
  } catch {
    await run('unzip', ['-q', '-o', file, '-d', dir], { timeout: UNZIP_TIMEOUT_MS, windowsHide: true })
  }
}
