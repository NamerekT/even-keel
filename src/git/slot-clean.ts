import { existsSync } from 'node:fs'
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { notice, type Notice } from '../notice/notice.js'
import { shownUnder } from '../paths.js'
import { DEFAULT_SLOT_CLEANUP } from '../settings/defaults.js'
import type { SlotCleanup } from '../state.js'
import { safeName } from '../taskmcp/downloads.js'
import { compilePatterns, matchesEntry, matchesPath, mayHold, type PathRule } from './patterns.js'
import type { Git } from './types.js'

export { DEFAULT_SLOT_CLEANUP }
export type { SlotCleanup }

export interface CleanedSlot {
  warnings: Notice[]
  bytes: number
  files: number
}

/** The one call a test replaces to hold a file as Unity or a background process does. */
export interface CleanIo {
  unlink: (path: string) => Promise<void>
}

/** `task_read`'s cache (`DOWNLOADS`): each task's folder goes with that task's Done, whatever the patterns say. */
const TASK_FILES = '.temp/task-files'

interface Walk {
  slot: string
  clean: PathRule[]
  keep: PathRule[]
  io: CleanIo
  bytes: number
  files: number
  left: string[]
}

/**
 * Empties what `clean` names in a slot, only among what git ignores: a tracked file is never touched and is named in a
 * warning. Links are removed as links. A file that cannot go is counted and left for the next Done; a folder git lists
 * as ignored (`.temp/`) stays, emptied. The task's own attachments go too.
 */
export async function cleanSlot(git: Git, repo: string, slot: string, task: string, cleanup: Readonly<SlotCleanup>, io: CleanIo = { unlink }): Promise<CleanedSlot> {
  const walk: Walk = { slot, clean: compilePatterns(cleanup.clean), keep: compilePatterns(cleanup.keep), io, bytes: 0, files: 0, left: [] }
  const warnings: Notice[] = []
  if (!existsSync(slot)) return { warnings, bytes: 0, files: 0 }
  const status = await git(slot, ['status', '--porcelain', '-z', '--ignored'])
  if (status.code !== 0) return { warnings, bytes: 0, files: 0 }
  const roots = status.out.split('\0').filter((entry) => entry.startsWith('!! ')).map((entry) => entry.slice(3))

  if (roots.some((root) => under(TASK_FILES, root))) await dropTaskFiles(walk, task)

  if (walk.clean.length > 0) {
    const tracked = await trackedMatches(git, walk)
    if (tracked.length > 0) warnings.push(notice('cleanup.slotTracked', { ...shownUnder(slot, repo), count: tracked.length, first: tracked[0]! }))
    for (const root of roots) await cleanRoot(walk, root)
  }
  if (walk.left.length > 0) warnings.push(notice('cleanup.slotTempLeft', { ...shownUnder(slot, repo), count: walk.left.length, first: walk.left[0]! }))
  return { warnings, bytes: walk.bytes, files: walk.files }
}

/** `root` as git lists it, a folder with a trailing `/`: whether `path` is that folder or lies inside it. */
function under(path: string, root: string): boolean {
  const folder = root.replace(/\/$/, '')
  return path === folder || (root.endsWith('/') && path.startsWith(`${folder}/`))
}

async function trackedMatches(git: Git, walk: Walk): Promise<string[]> {
  const listed = await git(walk.slot, ['ls-files', '-z'])
  if (listed.code !== 0) return []
  return listed.out.split('\0').filter((path) => path !== '' && matchesPath(walk.clean, path, false) && !matchesPath(walk.keep, path, false))
}

async function dropTaskFiles(walk: Walk, task: string): Promise<void> {
  const wanted = safeName(task).toLowerCase()
  const folder = join(walk.slot, ...TASK_FILES.split('/'))
  for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.toLowerCase() !== wanted) continue
    const rel = `${TASK_FILES}/${entry.name}`
    const stat = await lstat(join(folder, entry.name))
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      await removeFile(walk, rel, stat.isSymbolicLink() ? 0 : stat.size)
      continue
    }
    await visit(walk, rel, true, true)
    await removeDir(walk, rel)
  }
}

async function cleanRoot(walk: Walk, root: string): Promise<void> {
  const rel = root.replace(/\/$/, '')
  if (rel === '' || rel === TASK_FILES) return
  const stat = await lstat(join(walk.slot, rel)).catch(() => null)
  if (stat === null) return
  const dir = stat.isDirectory() && !stat.isSymbolicLink()
  if (matchesPath(walk.keep, rel, dir)) return
  const cleaned = matchesPath(walk.clean, rel, dir)
  if (!dir) {
    if (cleaned) await removeFile(walk, rel, stat.isSymbolicLink() ? 0 : stat.size)
    return
  }
  if (cleaned || mayHold(walk.clean, rel)) await visit(walk, rel, cleaned, false)
}

/** `all` — Even Keel's own folder: every entry goes, `keep` not read. */
async function visit(walk: Walk, rel: string, cleanedAbove: boolean, all: boolean): Promise<void> {
  let entries
  try {
    entries = await readdir(join(walk.slot, rel), { withFileTypes: true })
  } catch {
    if (cleanedAbove) walk.left.push(rel)
    return
  }
  for (const entry of entries) {
    const child = `${rel}/${entry.name}`
    if (!all && child === TASK_FILES) continue
    const stat = entry.isFile() ? null : await lstat(join(walk.slot, child)).catch(() => null)
    const link = stat?.isSymbolicLink() ?? false
    const dir = !link && (stat?.isDirectory() ?? false)
    if (!all && matchesEntry(walk.keep, child, dir)) continue
    const cleaned = cleanedAbove || matchesEntry(walk.clean, child, dir)
    if (dir) {
      if (cleaned || mayHold(walk.clean, child)) await visit(walk, child, cleaned, all)
      if (cleaned) await removeDir(walk, child)
    } else if (cleaned) {
      await removeFile(walk, child, link ? 0 : (stat ?? (await lstat(join(walk.slot, child)).catch(() => null)))?.size ?? 0)
    }
  }
}

/** A link goes as a link: `unlink`, or `rmdir` for a folder link Windows will not unlink, neither entering its target. */
async function removeFile(walk: Walk, rel: string, size: number): Promise<void> {
  const path = join(walk.slot, rel)
  try {
    await walk.io.unlink(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    if (code !== 'EPERM' && code !== 'EISDIR') return void walk.left.push(rel)
    try {
      if (!(await lstat(path)).isSymbolicLink()) return void walk.left.push(rel)
      await rmdir(path)
    } catch {
      return void walk.left.push(rel)
    }
  }
  walk.bytes += size
  walk.files += 1
}

/** A folder still holding what was kept or left stays. */
async function removeDir(walk: Walk, rel: string): Promise<void> {
  await rmdir(join(walk.slot, rel)).catch(() => {})
}
