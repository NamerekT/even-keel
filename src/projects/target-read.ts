import { remotesOf } from '../ci/remote.js'
import type { Git } from '../git/types.js'
import { notice, type Notice } from '../notice/notice.js'
import { pathsOf, samePath } from '../paths.js'
import type { ProjectDraft, SourceRead } from '../state.js'
import { expandFolder, type Folders } from './folder.js'
import { folderNames, look } from './place.js'
import { nameRefusal, targetKind } from './target.js'

export interface TargetDeps {
  git: Git
  platform: NodeJS.Platform
  folders: Folders
  /** Even Keel's projects folder, where a bare name goes. */
  ownDir: string
  /** The project that has the folder already, if any. */
  projectOf: (folder: string) => string | undefined
}

/** The draft with the source the field names; `draft: null` — blank, or refused by `notice`. */
export type TargetResolved = { draft: ProjectDraft; read: SourceRead; notice: null } | { draft: null; read: SourceRead | null; notice: Notice | null }

/** A full path of the platform, for the refusal of a relative one. */
const EXAMPLES: Partial<Record<NodeJS.Platform, string>> = { win32: 'C:\\Projects\\my-app', darwin: '/Users/me/Projects/my-app' }
const exampleOf = (platform: NodeJS.Platform) => EXAMPLES[platform] ?? '/home/me/projects/my-app'

/**
 * Reads the wizard's one field into the source a person used to pick (BTN-1093): the text's kind first
 * (`targetKind`), then the disk and git for a path — the top of a repository is a checkout already there, a folder
 * without git becomes a new repository, a path that is not there is made with one. A bare name is a new folder in the
 * projects folder, numbered past one that is taken. A relative path is never taken from the service's working folder.
 */
export async function readTarget(deps: TargetDeps, draft: ProjectDraft): Promise<TargetResolved> {
  const { target = '', folder, repo, ...bare } = draft
  const { git, platform, folders } = deps
  const refused = (code: Notice, read: SourceRead | null = null): TargetResolved => ({ draft: null, read, notice: code })
  const kind = targetKind(target, platform)
  if (kind.kind === 'blank') return { draft: null, read: null, notice: null }
  if (kind.kind === 'none') return refused(notice('wizard.notTarget', { example: exampleOf(platform) }))
  const typed = target.trim()
  // A clone and a new repository commit as git's own name and e-mail: none, and neither can be made.
  const made = async (next: ProjectDraft, read: SourceRead): Promise<TargetResolved> =>
    (await lacksIdentity(git, folders.home)) ? refused(notice('git.noIdentity', {}), read) : { draft: next, read, notice: null }
  if (kind.kind === 'address') {
    return made({ ...bare, repo, ...(folder === undefined ? {} : { folder }), source: 'clone', remote: typed }, { as: 'clone', host: kind.host })
  }
  const expanded = expandFolder(typed, folders.home, platform)
  const full = expanded === typed ? kind : targetKind(expanded, platform)
  if (full.kind === 'name') {
    const bad = nameRefusal(typed, platform)
    if (bad !== null) return refused(bad)
    return made({ ...bare, repo: '', source: 'new', folder: freeName(deps, typed) }, { as: 'name' })
  }
  if (full.kind !== 'path') {
    if (platform === 'win32' && /%[^%]+%/.test(expanded)) return refused(notice('wizard.noFolder', { path: typed }))
    return refused(notice('wizard.fullPath', { path: typed, example: exampleOf(platform) }))
  }
  const paths = pathsOf(platform)
  const normal = paths.normalize(expanded)
  const top = paths.parse(normal).root
  const path = normal.length > top.length ? normal.replace(platform === 'win32' ? /[\\/]+$/ : /\/+$/, '') : normal
  if (path.length <= top.length || samePath(path, folders.home, platform)) return refused(notice('wizard.rootFolder', { path }))
  for (const part of path.slice(top.length).split(/[\\/]/)) {
    const bad = part === '' ? null : nameRefusal(part, platform)
    if (bad !== null) return refused(bad)
  }
  if (!folders.isFolder(path)) return made({ ...bare, repo: path, source: 'new' }, { as: 'make' })
  const shown = await git(path, ['rev-parse', '--show-toplevel'])
  if (shown.missing === true) return refused(notice('git.missing', {}))
  if (shown.code === 0) {
    const root = paths.normalize(shown.out.trim())
    if (!samePath(root, path, platform)) return refused(notice('wizard.insideRepo', { path, root }))
    return { draft: { ...bare, repo: path, source: 'existing' }, read: { as: 'existing', remote: await firstRemote(git, root) }, notice: null }
  }
  // A `.git` git refuses to read (another owner, a broken one): the checkout's own check says what git says of it.
  if (folders.isFolder(paths.join(path, '.git'))) return { draft: { ...bare, repo: path, source: 'existing' }, read: { as: 'existing', remote: null }, notice: null }
  return made({ ...bare, repo: path, source: 'new' }, { as: 'here' })
}

/** The name, or the first numbered one, the projects folder has no files or project under; the disk says what is taken. */
function freeName(deps: TargetDeps, name: string): string {
  const paths = pathsOf(deps.platform)
  for (const candidate of folderNames(name, null)) {
    const at = paths.join(deps.ownDir, candidate)
    const state = look(at)
    if ((state === 'free' || state === 'empty') && deps.projectOf(at) === undefined) return candidate
  }
  return name
}

/** The repository's `origin`, or its first remote, the address without a user or a password; `null` — none. */
async function firstRemote(git: Git, root: string): Promise<{ name: string; url: string } | null> {
  const urls = await git(root, ['config', '--get-regexp', '^remote\\..*\\.url$'])
  if (urls.code !== 0) return null
  const remotes = remotesOf(urls.out)
  const first = remotes.find((each) => each.name === 'origin') ?? remotes[0]
  return first === undefined ? null : { name: first.name, url: first.url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1') }
}

/** `git config --get` ends with 1 for a value that is unset; any other failure is not taken for one. */
export async function lacksIdentity(git: Git, cwd: string): Promise<boolean> {
  const values = await Promise.all(['user.name', 'user.email'].map((key) => git(cwd, ['config', '--get', key])))
  return values.some((value) => value.code === 1 || (value.code === 0 && value.out.trim() === ''))
}
