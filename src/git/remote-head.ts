import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { gitDirs } from './dirs.js'
import type { Git } from './types.js'

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
/** A ref name the files can be trusted for: no `..` segment, nothing Windows cannot name. Others go to git. */
const PLAIN_REF = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\:*?"<>|\s]+$/

/** The parsed `packed-refs` of each common folder, while the file keeps its inode, mtime and size. */
const packed = new Map<string, { stamp: string; refs: Map<string, string> }>()

/**
 * The commit of `refs/remotes/<remote>/<branch>` in `repo`, null when there is none (BTN-1478). Read from the files git
 * keeps it in — the loose ref, then `packed-refs`, in the common folder of a linked worktree — so the CI watch's every
 * tick spawns no process. Git answers when the files cannot be trusted: no `.git` of its own, a reftable store, a
 * symbolic or unparsed ref, an unreadable file.
 */
export async function remoteHead(git: Git, repo: string, remote: string, branch: string): Promise<string | null> {
  const ref = `refs/remotes/${remote}/${branch}`
  const read = PLAIN_REF.test(ref) ? await fromFiles(repo, ref) : undefined
  if (read !== undefined) return read
  const answer = await git(repo, ['rev-parse', '--verify', '--quiet', ref])
  return answer.code === 0 ? answer.out.trim() : null
}

/** `undefined` — the files cannot tell. */
async function fromFiles(repo: string, ref: string): Promise<string | null | undefined> {
  try {
    const dirs = await gitDirs(repo)
    if (dirs === null) return undefined
    const { commonDir } = dirs
    if (await exists(join(commonDir, 'reftable'))) return undefined
    const loose = await readFile(join(commonDir, ref), 'utf8').catch(missing)
    if (loose !== null) return SHA.test(loose.trim()) ? loose.trim() : undefined
    const refs = await packedRefs(join(commonDir, 'packed-refs'))
    return refs === undefined ? undefined : (refs.get(ref) ?? null)
  } catch {
    return undefined
  }
}

async function packedRefs(file: string): Promise<Map<string, string> | undefined> {
  const info = await stat(file).catch(missing)
  if (info === null) return new Map()
  const stamp = [info.ino, info.mtimeMs, info.size].join('|')
  const known = packed.get(file)
  if (known?.stamp === stamp) return known.refs
  const refs = new Map<string, string>()
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    if (line === '' || line.startsWith('#') || line.startsWith('^')) continue
    const match = /^([0-9a-f]+) (\S+)\r?$/.exec(line)
    if (match === null || !SHA.test(match[1]!)) return undefined
    refs.set(match[2]!, match[1]!)
  }
  packed.set(file, { stamp, refs })
  return refs
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, (error: unknown) => (missing(error), false))

/** Null for a file that is not there; any other error is thrown on. */
function missing(error: unknown): null {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ENOTDIR') return null
  throw error
}
