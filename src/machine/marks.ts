import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { FolderMarks, FolderOwner } from '../link/machine.js'
import { TEST_INSTANCE_VAR } from './join.js'

/** The file in a repository's git folder that names the machine serving it. */
export const MARK_FILE = 'even-keel-machine'

/**
 * Where the mark of a folder lives: the repository's common git folder, so a linked worktree and its main checkout
 * share one mark. `undefined` — the folder has no git.
 */
export function markFileOf(folder: string): string | undefined {
  const dotGit = join(folder, '.git')
  if (!existsSync(dotGit)) return undefined
  if (statSync(dotGit).isDirectory()) return join(dotGit, MARK_FILE)
  const line = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]
  if (line === undefined) return undefined
  const gitDir = isAbsolute(line) ? line : resolve(folder, line)
  const common = join(gitDir, 'commondir')
  const commonDir = existsSync(common) ? resolve(gitDir, readFileSync(common, 'utf8').trim()) : gitDir
  return join(commonDir, MARK_FILE)
}

const ownerOf = (text: string): FolderOwner | undefined => {
  try {
    const value = JSON.parse(text) as Partial<FolderOwner>
    return typeof value.machine === 'string' && value.machine !== '' ? { machine: value.machine, name: typeof value.name === 'string' ? value.name : '' } : undefined
  } catch {
    return undefined
  }
}

async function readMark(file: string): Promise<FolderOwner | undefined> {
  try {
    return ownerOf(await readFile(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The marks of a machine in the folders it takes (`docs/machines/machine-side.md`, "The folder's mark"): its id, whatever host and
 * path reach the folder — a container, a network share. A mark that cannot be read is nobody's.
 */
export class GitFolderMarks implements FolderMarks {
  /** `self` — this machine as of now: the own machine's id is known only once it is made. */
  constructor(private readonly self: () => FolderOwner) {}

  async claim(folder: string, takeOver?: string): Promise<FolderOwner | undefined> {
    const file = markFileOf(folder)
    if (file === undefined) return undefined
    const me = this.self()
    const held = await readMark(file)
    if (held !== undefined && held.machine !== me.machine && held.machine !== takeOver) return held
    if (held?.machine !== me.machine || held.name !== me.name) await writeFile(file, `${JSON.stringify(me)}\n`)
    return undefined
  }

  async release(folders: string[]): Promise<void> {
    const me = this.self().machine
    for (const folder of folders) {
      const file = markFileOf(folder)
      if (file !== undefined && (await readMark(file))?.machine === me) await rm(file, { force: true })
    }
  }
}

/** A test instance (`EVEN_KEEL_TEST_INSTANCE=1`): it marks nothing and is refused nothing. */
export const NO_MARKS: FolderMarks = {
  claim: async () => undefined,
  release: async () => {},
}

/** The marks of this installation's machine; none in a test instance (the sandbox and bench kits). */
export function folderMarks(self: () => FolderOwner, env: NodeJS.ProcessEnv): FolderMarks {
  return env[TEST_INSTANCE_VAR] === '1' ? NO_MARKS : new GitFolderMarks(self)
}
