import { lstatSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRemote } from '../ci/remote.js'
import { isBranchName } from '../git/branches.js'
import { remoteName, sameRemote } from '../git/clone-progress.js'
import { isHeads, type ReadRemote, type RemoteHeads } from '../git/remote-run.js'
import { remoteOffer } from './remote-branches.js'
import type { Git } from '../git/types.js'
import { notice } from '../notice/notice.js'
import { pathsOf, samePath } from '../paths.js'
import type { FolderPlace, ProjectCheck, ProjectDraft } from '../state.js'
import type { TrackerAdapter } from '../tracker/source.js'
import { expandFolder, isFullPath, type Folders } from './folder.js'
import { nameRefusal } from './target.js'

/** Files counted in a folder that goes into a first commit; past it the page says "more than". */
const COUNT_CAP = 20_000
/** Folders of the projects folder asked for their remote when a clone is checked. */
const CLONES_ASKED = 20

export interface PlaceDeps {
  git: Git
  platform: NodeJS.Platform
  folders: Folders
  /** Even Keel's projects folder. */
  ownDir: string
  readRemote: ReadRemote
  /** The project that has the folder already, if any. */
  projectOf: (folder: string) => string | undefined
  adapter?: TrackerAdapter
  env?: Readonly<Record<string, string | undefined>>
}

type Repo = ProjectCheck['repo']
const NONE = { root: null, current: null, suggested: null, branches: null }

/** What a folder that is not the project's yet is on the disk. */
export function look(path: string): 'free' | 'empty' | 'filled' | 'file' {
  try {
    if (!statSync(path).isDirectory()) return 'file'
    return readdirSync(path).length === 0 ? 'empty' : 'filled'
  } catch {
    return 'free'
  }
}

type Holds = NonNullable<FolderPlace['holds']>

/**
 * The files a new repository's first commit would take from a folder and their size; stops counting at `cap` files.
 * Git itself is asked, against an empty repository of its own, so that every `.gitignore`, `info/exclude` and
 * `core.excludesFile` leave out what `git add -A` would (BTN-1092); a git that cannot be asked gives the whole folder.
 */
export async function measureFolder(git: Git, folder: string, cap: number = COUNT_CAP): Promise<Holds> {
  const listed = await committable(git, folder)
  if (listed === null) return walkFolder(folder, cap)
  const paths = pathsOf(process.platform)
  let files = 0
  let bytes = 0
  for (const name of listed) {
    let stats
    try {
      stats = lstatSync(paths.join(folder, name))
    } catch {
      stats = null
    }
    // An embedded repository is listed as its folder; the commit takes it as a link, nothing of its files.
    if (stats?.isDirectory() === true) continue
    if (files >= cap) return { files, bytes, capped: true }
    files += 1
    bytes += stats?.isFile() === true ? stats.size : 0
  }
  return { files, bytes, capped: false }
}

/** `git ls-files` of the folder as the work tree of a fresh repository in a temporary folder; null when git refuses. */
async function committable(git: Git, folder: string): Promise<string[] | null> {
  const empty = mkdtempSync(join(tmpdir(), 'even-keel-measure-'))
  try {
    if ((await git(empty, ['init', '--bare', '-q'])).code !== 0) return null
    const listed = await git(folder, [`--git-dir=${empty}`, `--work-tree=${folder}`, 'ls-files', '--others', '--exclude-standard', '-z'])
    if (listed.code !== 0) return null
    return listed.out.split('\0').filter((name) => name !== '')
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
}

/** Every file of the folder and their size, links not followed. */
function walkFolder(folder: string, cap: number): Holds {
  let files = 0
  let bytes = 0
  const left = [folder]
  while (left.length > 0) {
    const dir = left.pop()!
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = pathsOf(process.platform).join(dir, entry.name)
      if (entry.isDirectory()) left.push(path)
      else if (entry.isFile()) {
        if (files >= cap) return { files, bytes, capped: true }
        files += 1
        try {
          bytes += statSync(path).size
        } catch {
          // Gone between the listing and the look.
        }
      }
    }
  }
  return { files, bytes, capped: false }
}

/** A branch as a part of a folder's name: `release/v0.2` → `release-v0.2`. */
const branchSlug = (branch: string) => branch.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * The names tried for a folder nobody named, in order: the repository's, then with the branch
 * (`storefront-release-v0.2`), then that with a number.
 */
export function* folderNames(base: string, branch: string | null): Generator<string> {
  yield base
  const branched = branch === null || branchSlug(branch) === '' ? base : `${base}-${branchSlug(branch)}`
  if (branched !== base) yield branched
  for (let number = 2; number < 100; number += 1) yield `${branched}-${number}`
}

/**
 * The folder a clone, a new repository or a named folder of a project without git would get (BTN-1048): in Even Keel's
 * projects folder under the draft's name or a suggested free one, or the full path typed as "another folder". A clone
 * asks its remote first — the address, the rights and the default branch are known before "Create". A clone takes an
 * empty folder or none; a new repository takes a filled one and says what would go into its first commit.
 */
export async function checkPlace(deps: PlaceDeps, draft: ProjectDraft): Promise<Repo> {
  const { platform, ownDir } = deps
  const paths = pathsOf(platform)
  const plain = draft.git === false
  const clone = !plain && draft.source === 'clone'
  const remote = (draft.remote ?? '').trim()
  let heads: RemoteHeads | null = null
  if (clone) {
    if (remote === '') return { ...NONE, notice: null }
    const read = await deps.readRemote(remote)
    if (!isHeads(read)) return { ...NONE, notice: read }
    heads = read
  }
  // A refused folder or branch keeps the remote's branches in the field.
  const none = heads === null ? NONE : { ...NONE, remoteBranches: remoteOffer(heads, draft.branch) }
  const branch = draft.branch.trim()
  if (!plain && branch !== '' && !(await isBranchName(deps.git, deps.folders.home, branch))) return { ...none, notice: notice('wizard.branchName', { value: branch }) }
  const wanted = branch !== '' ? branch : (heads?.head ?? null)

  const typed = draft.repo.trim()
  let dir: string | null = null
  let name: string
  let path: string
  if (typed !== '') {
    const full = expandFolder(typed, deps.folders.home, platform)
    if (!isFullPath(full, platform)) return { ...none, notice: notice(platform === 'win32' && /%[^%]+%/.test(full) ? 'wizard.noFolder' : 'wizard.relativePath', { path: typed }) }
    path = paths.normalize(full)
    name = paths.basename(path)
  } else {
    dir = ownDir
    const given = (draft.folder ?? '').trim()
    const bad = given === '' ? null : nameRefusal(given, platform)
    if (bad !== null) return { ...none, notice: bad }
    const base = given !== '' ? given : clone ? remoteName(remote) : draft.name.trim() || draft.key.trim().toLowerCase()
    const safe = base.replace(/[<>:"|?*\\/]+/g, '-').replace(/[. ]+$/, '') || 'project'
    name = given
    if (name === '') {
      for (const candidate of folderNames(safe, clone ? wanted : null)) {
        name = candidate
        const at = paths.join(ownDir, candidate)
        if (look(at) !== 'filled' && look(at) !== 'file' && deps.projectOf(at) === undefined) break
      }
    }
    path = paths.join(ownDir, name)
  }

  const state = look(path)
  const suggested = clone ? suggestedOf(remote, deps) : null
  const found = { ...none, root: path, current: heads?.head ?? null, suggested }
  if (state === 'file') return { ...none, notice: notice('wizard.folderIsFile', { path }) }
  const place: FolderPlace = { dir, name, state }
  const taken = deps.projectOf(path)
  if (taken !== undefined) return { ...found, place, notice: notice(plain ? 'wizard.folderTaken' : 'wizard.repoTaken', { project: taken }) }
  if (plain) return { ...found, place, notice: null }
  if (clone) {
    const existing = dir === null ? undefined : await cloneThere(deps, remote, wanted)
    const offered = { ...place, ...(existing === undefined ? {} : { existing }) }
    return { ...found, place: offered, notice: state === 'filled' ? notice('wizard.folderFilled', { path }) : null }
  }
  if (state === 'free') return { ...found, place, notice: null }
  const top = await deps.git(path, ['rev-parse', '--show-toplevel'])
  if (top.missing === true) return { ...NONE, notice: notice('git.missing', {}) }
  if (top.code === 0 && samePath(top.out.trim(), path, platform)) return { ...found, place, notice: notice('wizard.alreadyRepo', { path }) }
  return { ...found, place: state === 'filled' ? { ...place, holds: await measureFolder(deps.git, path) } : place, notice: null }
}

function suggestedOf(remote: string, deps: PlaceDeps): string | null {
  const parsed = parseRemote(remote)
  if (parsed === null || deps.adapter?.projectOfRemote === undefined) return null
  return deps.adapter.projectOfRemote(parsed, remote, deps.env ?? {}) ?? null
}

/** A clone of the remote on the wanted branch that lies in the projects folder and is no project yet. */
async function cloneThere(deps: PlaceDeps, remote: string, branch: string | null): Promise<string | undefined> {
  const paths = pathsOf(deps.platform)
  const base = remoteName(remote).toLowerCase()
  let names: string[]
  try {
    names = readdirSync(deps.ownDir).filter((name) => name.toLowerCase().startsWith(base)).slice(0, CLONES_ASKED)
  } catch {
    return undefined
  }
  for (const name of names) {
    const folder = paths.join(deps.ownDir, name)
    if (deps.projectOf(folder) !== undefined) continue
    const top = await deps.git(folder, ['rev-parse', '--show-toplevel'])
    if (top.code !== 0 || !samePath(top.out.trim(), folder, deps.platform)) continue
    const origin = await deps.git(folder, ['config', '--get', 'remote.origin.url'])
    if (origin.code !== 0 || !sameRemote(origin.out.trim(), remote)) continue
    const current = await deps.git(folder, ['symbolic-ref', '--short', '-q', 'HEAD'])
    if (current.code === 0 && (branch === null || current.out.trim() === branch)) return folder
  }
  return undefined
}
