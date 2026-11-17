import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Git } from '../git/types.js'
import type { SettingsDrift } from './model.js'

type Json = Record<string, unknown>

const SHARED = '.claude/settings.json'

export interface ProjectSettings {
  /** `.claude/settings.json` as a task worktree has it: the branch's committed version. */
  project: Json | undefined
  /** The main checkout's `settings.local.json`: a worktree session does not read it, the page shows it as unread. */
  local: Json | undefined
  /** How the main checkout's `settings.json` differs from the branch's; absent when it does not, or git cannot tell. */
  drift?: SettingsDrift
}

/**
 * The project's Claude settings files as its chain sessions get them (EKR-128): a task worktree starts from the branch,
 * so an ignored or uncommitted `settings.json` never reaches it. A project without git runs its sessions in the folder.
 */
export async function readProjectSettings(git: Git, repo: string, branch: string, plain: boolean): Promise<ProjectSettings> {
  const disk = readText(join(repo, '.claude', 'settings.json'))
  const local = parseObject(readText(join(repo, '.claude', 'settings.local.json')))
  if (plain) return { project: parseObject(disk), local }
  const listed = await git(repo, ['ls-tree', '--name-only', branch, '--', SHARED])
  if (listed.code !== 0) return { project: undefined, local }
  const committed = listed.out.trim() === '' ? undefined : await git(repo, ['show', `${branch}:${SHARED}`])
  const text = committed?.code === 0 ? committed.out : undefined
  const drift = await driftOf(git, repo, disk, text)
  return { project: parseObject(text), local, ...(drift !== undefined && { drift }) }
}

async function driftOf(git: Git, repo: string, disk: string | undefined, branch: string | undefined): Promise<SettingsDrift | undefined> {
  if (disk === undefined) return undefined
  if (branch !== undefined) return sameSettings(disk, branch) ? undefined : 'edited'
  // `check-ignore` exits 0 for an ignored path, 1 for one nothing ignores.
  return (await git(repo, ['check-ignore', '-q', '--', SHARED])).code === 0 ? 'ignored' : 'uncommitted'
}

/** Line endings and formatting are no edit: Git for Windows may check the file out with CRLF. */
function sameSettings(a: string, b: string): boolean {
  const canonical = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text))
    } catch {
      return text.replace(/\r\n/g, '\n').trim()
    }
  }
  return canonical(a) === canonical(b)
}

function readText(file: string): string | undefined {
  try {
    const text = readFileSync(file, 'utf8')
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } catch {
    return undefined
  }
}

function parseObject(text: string | undefined): Json | undefined {
  if (text === undefined) return undefined
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
  } catch {
    return undefined
  }
}
