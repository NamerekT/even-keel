import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { GitResult } from '../../git/types.js'
import { fileHash } from '../record.js'
import { MEMORY_FLAVOR, type SyncFlavor } from './flavor.js'

export type RunGit = (...args: string[]) => Promise<GitResult>

/**
 * The trailer of a sync's commit that kept the newer of two versions changed on the same lines (BTN-1686):
 * `Memory-Conflict: <file>`, `Config-Conflict: <file>` in the global configuration (`SyncFlavor.trailer`). Its parent
 * holds the other version in the file, so no hash in the message goes stale when a refused push rebases the commit
 * again. The conflict stays open until a later commit changes the file: the file saved after it, on any machine.
 */
export const CONFLICT_TRAILER = MEMORY_FLAVOR.trailer

/**
 * The open conflicts of a working copy as its last sync saw them, in its `.git` so that no file lies beside the records.
 * The `agent-bridge` plugin's `memory-conflicts.mjs` hook reads it by this path: change both together.
 */
export const CONFLICTS_FILE = join('.git', 'even-keel-conflicts.json')

/** Of the other version's text, this much goes into a session's context. */
const OTHER_LIMIT = 32 * 1024

export interface MemoryConflict {
  /** The file, relative to the folder, `/` between its parts. */
  file: string
  /** The commit that kept the newer version in the file. */
  commit: string
  /** The commit whose `file` is the other version. */
  other: string
  /** When the conflict was met (ISO). */
  since: string
  /** The machine it was met on: the author of `commit`. Absent in a conflicts file of before BTN-1692. */
  by?: string
  /** `fileHash` of the file as the conflict left it: a file no longer so was saved since, its conflict ending. */
  hash: string
  /** The other version's text. */
  otherText: string
  /** A person settles it, never a session (`SyncFlavor.human`): the hook leaves it out (BTN-1690). */
  human?: true
  /** What a session with file memory is told (the hook); for a `human` one, what the log and the page say. */
  note: string
}

/** The trailer line of a conflict whose other version is `file` of `other`. */
export function conflictTrailer(file: string, trailer = CONFLICT_TRAILER): string {
  return `${trailer}: ${file}`
}

/**
 * The conflicts the history leaves open, newest first, one a file. A person's choice (`SyncFlavor.settled`) newer than
 * a file's last conflict ends it as a later change of the file does.
 */
export async function openConflicts(git: RunGit, folder: string, flavor: SyncFlavor = MEMORY_FLAVOR): Promise<MemoryConflict[]> {
  if ((await git('rev-parse', '--verify', '-q', 'HEAD')).code !== 0) return []
  const { trailer, settled } = flavor
  const log = await git('log', '--format=%H%x1f%aI%x1f%an%x1f%B%x1e', `--grep=^${trailer}:`, `--grep=^${settled}:`, 'HEAD')
  if (log.code !== 0) return []
  const seen = new Set<string>()
  const open: MemoryConflict[] = []
  for (const entry of log.out.split('\x1e')) {
    const [commit, since, by, body] = entry.trim().split('\x1f')
    if (commit === undefined || since === undefined || by === undefined || body === undefined) continue
    for (const line of body.split('\n')) {
      const ended = line.startsWith(`${settled}: `) ? line.slice(settled.length + 2).trim() : ''
      if (ended !== '') seen.add(ended)
      const file = line.startsWith(`${trailer}: `) ? line.slice(trailer.length + 2).trim() : ''
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
      const conflict = { file, commit, other, since, by, hash: fileHash(readFileSync(path, 'utf8')), otherText }
      if (flavor.human(file)) open.push({ ...conflict, human: true, note: humanNote(conflict, folder) })
      else open.push({ ...conflict, note: conflictNote(conflict, folder, 'file', flavor) })
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
export function conflictNote(conflict: Pick<MemoryConflict, 'file' | 'other' | 'otherText'>, folder: string, how: 'file' | 'tool', flavor: SyncFlavor = MEMORY_FLAVOR): string {
  const name = conflict.file.replace(/\.md$/, '')
  const other = conflict.otherText.length > OTHER_LIMIT ? `${conflict.otherText.slice(0, OTHER_LIMIT)}\n[… cut]\n` : conflict.otherText
  const show = `\`git -C "${folder}" show ${conflict.other}:${conflict.file}\``
  const head =
    flavor.kind === 'config'
      ? `The global configuration file ${conflict.file} (in ${folder}, the user's skills, agents, commands and CLAUDE.md shared by every machine) is in a sync conflict: two machines changed the same lines of it between their syncs, or each had its own version. The file holds the newer version; the other one is below, and in the configuration repository's history (${show}). Read the file, merge into it what only the other version has, and save it: the conflict ends once any session saves the file.`
      : how === 'file'
        ? `The project memory record ${conflict.file} (in ${folder}) is in a sync conflict: two machines changed the same lines of it between their syncs. The file holds the newer version; the other one is below, and in the memory repository's history (${show}). Read the file, merge into it what only the other version has, and save it: the conflict ends once any session saves the record.`
        : `The project memory record ${name} is in a sync conflict: two machines changed the same lines of it between their syncs. memory_read gives the newer version; the other one is below. Merge into the record what only the other version has and write it with memory_write and the version memory_read gave: the conflict ends once any session saves the record.`
  return `${head}\n\n<other-version file="${conflict.file}">\n${other}</other-version>`
}

/** A conflict a person settles: where the other version is. */
function humanNote(conflict: Pick<MemoryConflict, 'file' | 'other'>, folder: string): string {
  return `${conflict.file} of the global configuration (${folder}) was changed on two machines: the newer version is kept, the other is \`git -C "${folder}" show ${conflict.other}:${conflict.file}\`. Choose the version on the page (the configuration conflict banner), or save the file again: either ends the conflict.`
}
