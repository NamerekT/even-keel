import { existsSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { GitResult } from '../../git/types.js'
import { memoryFile, parseMemoryFile } from '../record.js'

export type RunGit = (...args: string[]) => Promise<GitResult>

interface Stages {
  /** The upstream's blob: during a rebase stage 2 is what the remote has. */
  remote?: string
  /** The blob of the local commit being replayed (stage 3). */
  own?: string
}

/**
 * Settles every unmerged path of a stopped rebase so that it can go on (BTN-1645). The own version stays in the file;
 * the remote's, when it differs, goes beside it as `<stem>.conflict.md` with the description saying to merge it into the
 * file, so that the next session that reads the index sees it. A side that deleted the file loses to the side that
 * changed it: only an uncontested deletion removes a record. Gives the side files made; `null` — a path it could not settle.
 */
export async function settleConflicts(git: RunGit, folder: string): Promise<string[] | null> {
  const listed = await git('ls-files', '-u', '-z')
  if (listed.code !== 0) return null
  const paths = new Map<string, Stages>()
  for (const entry of listed.out.split('\0')) {
    const match = /^\d+ ([0-9a-f]+) ([123])\t(.+)$/s.exec(entry)
    if (match === null) continue
    const stages = paths.get(match[3]!) ?? {}
    if (match[2] === '2') stages.remote = match[1]!
    if (match[2] === '3') stages.own = match[1]!
    paths.set(match[3]!, stages)
  }
  const sides: string[] = []
  for (const [path, stages] of paths) {
    const made: string[] = []
    if (stages.own !== undefined && stages.remote !== undefined && path !== 'MEMORY.md') {
      const blob = await git('cat-file', 'blob', stages.remote)
      if (blob.code !== 0) return null
      const side = freeSide(folder, path)
      writeFileSync(join(folder, side), sideText(blob.out, path, side))
      made.push(side)
    }
    // In a rebase `--theirs` is the commit being replayed, the own one.
    const keep = await git('checkout', stages.own !== undefined ? '--theirs' : '--ours', '--', path)
    const added = keep.code === 0 ? await git('add', '--', path, ...made) : keep
    if (added.code !== 0) return null
    sides.push(...made)
  }
  return sides
}

function freeSide(folder: string, path: string): string {
  const ext = extname(path)
  const stem = join(dirname(path), basename(path, ext))
  for (let n = 1; ; n++) {
    const side = `${stem}.conflict${n === 1 ? '' : `-${n}`}${ext}`.replace(/^\.[\\/]/, '')
    if (!existsSync(join(folder, side))) return side
  }
}

function sideText(text: string, path: string, side: string): string {
  if (!path.endsWith('.md')) return `${text}\n`
  const fact = parseMemoryFile(text, basename(path, '.md'))
  const description = `MERGE into ${basename(path)}, then delete this file: another machine's version of it${fact.description === '' ? '' : ` — ${fact.description}`}`
  return memoryFile({ ...fact, name: basename(side, '.md'), description })
}
