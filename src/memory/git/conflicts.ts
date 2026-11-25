import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GitResult } from '../../git/types.js'
import { fileHash } from '../record.js'

export type RunGit = (...args: string[]) => Promise<GitResult>

/**
 * The trailer of a sync's commit that kept the newer of two versions changed on the same lines (BTN-1686):
 * `Memory-Conflict: <file>`. Its parent holds the other version in the file, so no hash in the message goes stale when
 * a refused push rebases the commit again. The conflict stays open until a later commit changes the file: the record
 * saved after it, by a session of any machine.
 */
export const CONFLICT_TRAILER = 'Memory-Conflict'

/**
 * The open conflicts of a working copy as its last sync saw them, in its `.git` so that no file lies beside the records.
 * The `agent-bridge` plugin's `memory-conflicts.mjs` hook reads it by this path: change both together.
 */
export const CONFLICTS_FILE = join('.git', 'even-keel-conflicts.json')

/** Of the other version's text, this much goes into a session's context. */
const OTHER_LIMIT = 32 * 1024

export interface MemoryConflict {
  /** The record's file, relative to the folder. */
  file: string
  /** The commit that kept the newer version in the file. */
  commit: string
  /** The commit whose `file` is the other version. */
  other: string
  /** When the conflict was met (ISO). */
  since: string
  /** `fileHash` of the file as the conflict left it: a file no longer so was saved since, its conflict ending. */
  hash: string
  /** The other version's text. */
  otherText: string
  /** What a session with file memory is told (the hook). */
  note: string
}

/** The trailer line of a conflict whose other version is `file` of `other`. */
export function conflictTrailer(file: string): string {
  return `${CONFLICT_TRAILER}: ${file}`
}

/** The conflicts the history leaves open, newest first, one a file. */
export async function openConflicts(git: RunGit, folder: string): Promise<MemoryConflict[]> {
  if ((await git('rev-parse', '--verify', '-q', 'HEAD')).code !== 0) return []
  const log = await git('log', '--format=%H%x1f%aI%x1f%B%x1e', `--grep=^${CONFLICT_TRAILER}:`, 'HEAD')
  if (log.code !== 0) return []
  const seen = new Set<string>()
  const open: MemoryConflict[] = []
  for (const entry of log.out.split('\x1e')) {
    const [commit, since, body] = entry.trim().split('\x1f')
    if (commit === undefined || since === undefined || body === undefined) continue
    for (const line of body.split('\n')) {
      const file = line.startsWith(`${CONFLICT_TRAILER}: `) ? line.slice(CONFLICT_TRAILER.length + 2).trim() : ''
      if (file === '' || seen.has(file)) continue
      seen.add(file)
      const path = join(folder, file)
      if (!existsSync(path)) continue
      const later = await git('rev-list', '--count', `${commit}..HEAD`, '--', file)
      if (later.code !== 0 || later.out !== '0') continue
      const parent = await git('rev-parse', '--verify', '-q', `${commit}^`)
      if (parent.code !== 0) continue
      const other = parent.out
      const shown = await git('show', `${other}:${file}`)
      const otherText = shown.code === 0 ? `${shown.out}\n` : ''
      const conflict = { file, commit, other, since, hash: fileHash(readFileSync(path, 'utf8')), otherText }
      open.push({ ...conflict, note: conflictNote(conflict, folder, 'file') })
    }
  }
  return open
}

/** The open conflicts for the hook and the memory tools; no file when there are none. */
export function saveConflicts(folder: string, conflicts: readonly MemoryConflict[]): void {
  const path = join(folder, CONFLICTS_FILE)
  if (conflicts.length === 0) {
    rmSync(path, { force: true })
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ conflicts }, null, 2)}\n`)
}

/** The conflicts the last sync left open whose file is still as the conflict left it. */
export function pendingConflicts(folder: string): MemoryConflict[] {
  let conflicts: MemoryConflict[]
  try {
    conflicts = (JSON.parse(readFileSync(join(folder, CONFLICTS_FILE), 'utf8')) as { conflicts: MemoryConflict[] }).conflicts
  } catch {
    return []
  }
  return conflicts.filter((conflict) => {
    try {
      return fileHash(readFileSync(join(folder, conflict.file), 'utf8')) === conflict.hash
    } catch {
      return false
    }
  })
}

/** What a session is told of a conflict: `file` — it edits the folder's files, `tool` — it has the memory tools. */
export function conflictNote(conflict: Pick<MemoryConflict, 'file' | 'other' | 'otherText'>, folder: string, how: 'file' | 'tool'): string {
  const name = conflict.file.replace(/\.md$/, '')
  const other = conflict.otherText.length > OTHER_LIMIT ? `${conflict.otherText.slice(0, OTHER_LIMIT)}\n[… cut]\n` : conflict.otherText
  const head =
    how === 'file'
      ? `The project memory record ${conflict.file} (in ${folder}) is in a sync conflict: two machines changed the same lines of it between their syncs. The file holds the newer version; the other one is below, and in the memory repository's history (\`git -C "${folder}" show ${conflict.other}:${conflict.file}\`). Read the file, merge into it what only the other version has, and save it: the conflict ends once any session saves the record.`
      : `The project memory record ${name} is in a sync conflict: two machines changed the same lines of it between their syncs. memory_read gives the newer version; the other one is below. Merge into the record what only the other version has and write it with memory_write and the version memory_read gave: the conflict ends once any session saves the record.`
  return `${head}\n\n<other-version file="${conflict.file}">\n${other}</other-version>`
}
