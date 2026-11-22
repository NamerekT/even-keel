import { existsSync, readdirSync } from 'node:fs'
import { remotesOf, type Remote } from '../ci/remote.js'
import { sameRemote } from '../git/clone-progress.js'
import { remoteUrls } from '../git/remote-urls.js'
import type { Git } from '../git/types.js'
import type { FolderProbe } from '../link/view.js'
import { fail, NoticeError, notice, type Notice } from '../notice/notice.js'
import { missingCommands, type StdioServer } from '../packages/stdio.js'
import { isTrusted } from '../projects/check.js'

export type { FolderProbe }

/** The checks of a project's folder on a machine before the machine joins the project's pool (BTN-1271), in order. */
export const FOLDER_STEPS = ['repo', 'remote', 'branch', 'trust', 'packages', 'push'] as const
export type FolderStep = (typeof FOLDER_STEPS)[number]

/** What the hub knows of the project that the machine's folder is checked against. */
export interface FolderSpec {
  project: string
  folder: string
  /** The addresses of the project's remotes in the hub's folder. */
  remotes: string[]
  /** The project's main branch (`branch`). */
  branch: string
  /** Claude Code runs the project's sessions: the folder has to be trusted. */
  claude: boolean
}

export interface FolderCheckDeps {
  git: Git
  /** The `.claude.json` of every Claude account folder of the machine, read; `undefined` — a file that is none. */
  claudeConfigs: () => unknown[]
  packages: { installingOf(project: string): string[]; unready(project: string): string[]; trackerMissing(project: string): string | undefined; localStdio(project: string): StdioServer[] }
  /** Whether a server's command starts on the machine (`commandFound`). */
  found?: (command: string) => boolean
  wait?: (ms: number) => Promise<void>
  /** How long the packages step waits for an installation under way. */
  packagesWaitMs?: number
}

const PACKAGES_POLL_MS = 1000
const PACKAGES_WAIT_MS = 3 * 60_000

/** The folder's remote that is the project's: one of the hub's addresses, the scheme and `.git` apart. */
async function projectRemote(git: Git, spec: Pick<FolderSpec, 'folder' | 'remotes'>): Promise<Remote | undefined> {
  const urls = await remoteUrls(git, spec.folder)
  if (urls.code !== 0) return undefined
  return remotesOf(urls.out).find((remote) => spec.remotes.some((url) => sameRemote(url, remote.url)))
}

/** One check of the folder; `null` — it passed, else what the person does about it. */
export async function checkFolderStep(deps: FolderCheckDeps, step: FolderStep, spec: FolderSpec): Promise<Notice | null> {
  const { git } = deps
  const { folder, branch } = spec
  if (step === 'repo') {
    const top = await git(folder, ['rev-parse', '--is-inside-work-tree'])
    if (top.missing === true) return notice('pool.noGit', {})
    return top.code === 0 && top.out.trim() === 'true' ? null : notice('pool.notRepository', { folder })
  }
  if (step === 'remote') {
    if (spec.remotes.length === 0) return notice('pool.hubNoRemote', {})
    return (await projectRemote(git, spec)) === undefined ? notice('pool.otherRemote', { folder, remote: spec.remotes[0]! }) : null
  }
  if (step === 'branch') {
    const remote = await projectRemote(git, spec)
    const refs = [`refs/heads/${branch}`, ...(remote === undefined ? [] : [`refs/remotes/${remote.name}/${branch}`])]
    for (const ref of refs) if ((await git(folder, ['rev-parse', '--verify', '--quiet', ref])).code === 0) return null
    return notice('pool.noBranch', { folder, branch })
  }
  if (step === 'trust') {
    if (!spec.claude) return null
    return deps.claudeConfigs().some((config) => isTrusted(config, folder)) ? null : notice('pool.untrusted', { folder })
  }
  if (step === 'packages') {
    const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    const until = Date.now() + (deps.packagesWaitMs ?? PACKAGES_WAIT_MS)
    while (deps.packages.installingOf(spec.project).length > 0 && Date.now() < until) await wait(PACKAGES_POLL_MS)
    const installing = deps.packages.installingOf(spec.project)
    if (installing.length > 0) return notice('pool.packagesInstalling', { names: installing.join(', ') })
    const unready = deps.packages.unready(spec.project)
    if (unready.length > 0) return notice('pool.packagesUnready', { names: unready.join(', ') })
    const tracker = deps.packages.trackerMissing(spec.project)
    if (tracker !== undefined) return notice('pool.packagesNoTracker', { server: tracker })
    const missing = missingCommands(deps.packages.localStdio(spec.project), deps.found)
    return missing.length > 0 ? notice('pool.serverMissing', { names: missing.join(', ') }) : null
  }
  // A push of the main branch onto itself sends nothing, yet the remote checks the right to push before it answers.
  const remote = await projectRemote(git, spec)
  if (remote === undefined) return notice('pool.otherRemote', { folder, remote: spec.remotes[0] ?? '' })
  const tracked = (await git(folder, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote.name}/${branch}`])).code === 0
  const source = tracked ? `refs/remotes/${remote.name}/${branch}` : `refs/heads/${branch}`
  const push = await git(folder, ['push', '--dry-run', '--porcelain', remote.name, `${source}:refs/heads/${branch}`])
  return push.code === 0 || behindOnly(push.out) ? null : notice('pool.noPush', { remote: remote.url }, { detail: push.out.trim() })
}

/**
 * git refused the dry run only because the remote branch went ahead of the folder's copy (BTN-1513): git decides that
 * after the forge answered the push, so the right to push is there.
 */
function behindOnly(out: string): boolean {
  const refused = out.split('\n').filter((line) => line.startsWith('!'))
  return refused.length > 0 && refused.every((line) => /\t\[rejected\] \((fetch first|non-fast-forward)\)\s*$/.test(line))
}

/** The folder a clone goes into: absent, or empty. */
export function cloneTarget(folder: string): void {
  if (!folderFree(folder)) throw fail('pool.folderNotEmpty', { folder })
}

function folderFree(folder: string): boolean {
  try {
    return !existsSync(folder) || readdirSync(folder).length === 0
  } catch {
    return false
  }
}

/** What the folder is to a project with these remotes (`FolderProbe`, BTN-1297). */
export async function probeFolder(git: Git, folder: string, remotes: string[]): Promise<FolderProbe> {
  if (folderFree(folder)) return { state: 'free' }
  const top = await git(folder, ['rev-parse', '--is-inside-work-tree'])
  if (top.missing === true) return { state: 'taken', notice: notice('pool.noGit', {}) }
  if (top.code !== 0 || top.out.trim() !== 'true') return { state: 'taken', notice: notice('pool.folderNotEmpty', { folder }) }
  if ((await projectRemote(git, { folder, remotes })) !== undefined) return { state: 'clone' }
  return { state: 'taken', notice: notice('pool.foreignRepo', { folder, remote: remotes[0] ?? '' }) }
}

/** A check's refusal as the error a job's step fails with. */
export function throwOf(refusal: Notice | null): void {
  if (refusal !== null) throw new NoticeError(refusal)
}
