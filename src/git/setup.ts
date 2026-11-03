import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { fail } from '../notice/notice.js'
import { expandHome } from '../projects/folder.js'
import type { GitSetupView } from '../state.js'
import { runGit } from './run.js'
import type { Git, GitResult } from './types.js'

const FIRST_COMMIT = 'Initial commit'

/** Throws `git.missing` when git did not start at all: not installed, or gone from the service's PATH. */
export function requireStarted(result: GitResult): GitResult {
  if (result.missing === true) throw fail('git.missing', {})
  return result
}

export async function readGitSetup(git: Git, home: string): Promise<GitSetupView> {
  const started = await git(home, ['--version'])
  const version = started.code === 0 ? (/(\d+(?:\.\d+)+)/.exec(started.out)?.[1] ?? started.out.trim()) : null
  if (version === null) return { version: null, name: null, email: null }
  const [name, email] = await Promise.all(['user.name', 'user.email'].map((key) => configValue(git, home, key)))
  return { version, name: name ?? null, email: email ?? null }
}

/** The value git would commit with, from any of its configs; `null` — unset. */
async function configValue(git: Git, cwd: string, key: string): Promise<string | null> {
  const read = requireStarted(await git(cwd, ['config', '--get', key]))
  const value = read.code === 0 ? read.out.trim() : ''
  return value === '' ? null : value
}

/** Writes the name and e-mail into git's global config: a setting of git's, not an install. */
export async function saveIdentity(git: Git, home: string, name: string, email: string): Promise<void> {
  const values = { name: name.trim(), email: email.trim() }
  if (values.name === '' || values.email === '') throw fail('git.identityBlank', {})
  for (const key of ['name', 'email'] as const) {
    const written = requireStarted(await git(home, ['config', '--global', `user.${key}`, values[key]]))
    if (written.code !== 0) throw fail('git.identityFailed', {}, { detail: written.out })
  }
}

/**
 * Makes the wizard's folder a repository whose `branch` is born: `git init -b` for a folder without one, the unborn
 * branch of a fresh `git init` renamed, then an empty first commit. A repository with commits is left as it is.
 */
export async function initRepository(git: Git, path: string, branch: string): Promise<void> {
  if (!isFolder(path)) throw fail('wizard.noFolder', { path })
  if (requireStarted(await git(path, ['check-ref-format', '--branch', branch])).code !== 0) throw fail('wizard.branchName', { value: branch })
  // The commit needs them: refused here, the folder is left as it was.
  const [name, email] = await Promise.all(['user.name', 'user.email'].map((key) => configValue(git, path, key)))
  if (name === null || email === null) throw fail('git.noIdentity', {})
  const top = await git(path, ['rev-parse', '--show-toplevel'])
  const must = async (args: string[]) => {
    const result = requireStarted(await git(path, args))
    if (result.code !== 0) throw fail('git.initFailed', { path }, { detail: result.out })
  }
  if (top.code !== 0) await must(['init', '-b', branch])
  else if ((await git(path, ['rev-parse', '--verify', '--quiet', 'HEAD'])).code === 0) return
  else await must(['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  await must(['commit', '--allow-empty', '-m', FIRST_COMMIT])
}

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The view the page's Git step shows, read at the start and on "Check again". */
export class GitSetup {
  private current: GitSetupView | undefined
  /** A read ended: the page shows it. */
  changed: (() => void) | undefined

  constructor(
    private readonly git: Git = runGit,
    private readonly home: string = homedir(),
  ) {}

  /** `undefined` — not read yet. */
  view(): GitSetupView | undefined {
    return this.current
  }

  async check(): Promise<void> {
    this.current = await readGitSetup(this.git, this.home)
    this.changed?.()
  }

  async identity(name: string, email: string): Promise<void> {
    await saveIdentity(this.git, this.home, name, email)
    await this.check()
  }

  async init(path: string, branch: string): Promise<void> {
    await initRepository(this.git, expandHome(path, this.home), branch)
  }
}

export const gitSetup = new GitSetup()
