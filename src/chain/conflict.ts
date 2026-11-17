import type { Git } from '../git/types.js'
import type { ConflictFile } from '../state.js'

const MARKER = /^(<{7}|={7}|\|{7}|>{7})(?: |$)/

/** The lines inside a file's conflict blocks, `<<<<<<<` to `>>>>>>>`, the marker lines left out. */
export function conflictLines(text: string): number {
  let inside = false
  let lines = 0
  for (const line of text.split(/\r?\n/)) {
    const marker = MARKER.exec(line)?.[1]
    if (marker === undefined) {
      if (inside) lines += 1
    } else if (marker.startsWith('<')) inside = true
    else if (marker.startsWith('>')) inside = false
  }
  return lines
}

/**
 * Each conflicted file of a failed merge with its conflict lines (EKR-134), read before `merge --abort`. A file deleted
 * on one side has no markers and no lines: the index lacks its stage of that side.
 */
export async function readConflict(git: Git, repo: string, files: string[], read: (path: string) => Promise<string | null>): Promise<ConflictFile[]> {
  const stages = new Map<string, Set<string>>()
  for (const entry of (await git(repo, ['ls-files', '--unmerged', '-z'])).out.split('\0')) {
    const tab = entry.indexOf('\t')
    if (tab < 0) continue
    const stage = entry.slice(0, tab).split(' ')[2]
    const path = entry.slice(tab + 1)
    if (stage !== undefined) stages.set(path, (stages.get(path) ?? new Set()).add(stage))
  }
  return Promise.all(
    files.map(async (path): Promise<ConflictFile> => {
      const seen = stages.get(path)
      if (seen !== undefined && (!seen.has('2') || !seen.has('3'))) return { path, lines: null }
      const text = await read(path)
      return { path, lines: text === null ? 0 : conflictLines(text) }
    }),
  )
}
