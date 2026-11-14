import { DEFAULT_PROVIDER } from '../agent/providers.js'
import type { ChainRules } from '../chain/rules.js'
import { CLAUDE } from '../claude/name.js'
import { parseRemote, remotesOf } from '../ci/remote.js'
import { withNewProject, yieldedMilestones } from '../config-form.js'
import { DEFAULT_BRANCH, isPlainObject, parseConfig, projectLabels, runSettings } from '../config.js'
import { currentBranch, isBranchName, readBranches } from '../git/branches.js'
import { sharedRemoteReader, type ReadRemote } from '../git/remote-run.js'
import type { Git } from '../git/types.js'
import { fail, notice, NoticeError, noticeOf, type Notice } from '../notice/notice.js'
import { pathsOf, samePath, sameSpelling, workingFolder } from '../paths.js'
import type { ProjectCheck, ProjectDraft } from '../state.js'
import { expandFolder, isFullPath, REAL_FOLDERS, type Folders } from './folder.js'
import { projectsDir } from './own-folder.js'
import { checkPlace } from './place.js'
import { lacksIdentity, readTarget } from './target-read.js'
import { errorText, TrackerLink } from '../tracker/link.js'
import { isOpen } from '../tracker/model.js'
import { trackerOf, type TrackerAdapter } from '../tracker/source.js'
import { isOwnRepo, readIssueTemplates, templateHits, type IssueTemplate } from '../tracker/templates.js'

export interface CheckDeps {
  git: Git
  /** The config file as it is now. */
  raw: () => unknown
  adapters: Readonly<Record<string, TrackerAdapter>>
  /** The values of the tracker profile the draft would run on. */
  env: Record<string, string | undefined>
  /**
   * The `.claude.json` files whose trust the draft's sessions get: the global one and that of the account folder its
   * chain runs on, where `claude` started with that folder records the dialog (BTN-300); `undefined` — a file that is none.
   */
  claudeConfigs: () => unknown[]
  timeoutMs: number
  platform?: NodeJS.Platform
  /** The machine's answer about the typed folder; the real one by default. */
  folders?: Folders
  /** Where a project without git that names no folder gets its own; `projectsDir()` by default. */
  projectsDir?: string
  /** Asks a clone's remote for its branches; the shared reader by default. */
  readRemote?: ReadRemote
  /** The user the service runs as. */
  user: string
  /** Even Keel runs as a system service (`ProjectCheck.service`). */
  service: boolean
}

const ENTRY_ID = 'wizard-check'

/**
 * What the wizard's draft would come to: the repository and its branch, the config with the draft added, the tracker's
 * answer for the project and Claude Code's trust in the folder, for a project Claude may run on. Each step that needs an earlier one is left `null`
 * until that one passes. `tracker: false` — the page holds the tracker's answer for the draft's tracker project (BTN-737):
 * the rest is checked and the tracker is not asked, `tracker` comes back `null`.
 */
export async function checkDraft(deps: CheckDeps, draft: ProjectDraft, options: { tracker: boolean } = { tracker: true }): Promise<ProjectCheck> {
  const platform = deps.platform ?? process.platform
  const raw = deps.raw()
  const adapter = deps.adapters[draft.tracker]
  const repo = await checkRepo(deps.git, draft, raw, platform, adapter, deps.env, deps.folders, deps.projectsDir, deps.readRemote)
  // A folder Even Keel makes or fills when the project is created gets its trust then: nothing to trust yet.
  const unmade = repo.place !== undefined || (draft.git === false && draft.repo.trim() === '')
  const branch = draft.branch.trim() || repo.current || DEFAULT_BRANCH
  let entry: Notice | null = null
  let rules: ChainRules | undefined
  let yields: string[] = []
  try {
    const placed = { ...draft, repo: repo.root ?? draft.repo, branch }
    const config = parseConfig(withNewProject(raw, placed, ENTRY_ID, deps.adapters), deps.adapters)
    rules = config.rules[ENTRY_ID]!
    const names = projectLabels(config)
    yields = Object.keys(yieldedMilestones(raw, placed, ENTRY_ID, deps.adapters)).map((project) => names[project]!)
  } catch (error) {
    const refused = noticeOf(error)
    // No folder yet is the repository step's to say (BTN-1107): its own refusal, or the footer for a blank field.
    entry = refused.code === 'config.repoEmpty' && repo.root === null ? null : keyNotice(refused)
  }
  const tracker =
    options.tracker && entry === null && rules !== undefined && adapter !== undefined && repo.root !== null && repo.notice === null
      ? await checkTracker(adapter, deps, draft.key.trim(), draft.trackerProject.trim(), rules, { root: repo.root, branch })
      : null
  const provider = draft.provider ?? (isPlainObject(raw) && typeof raw.provider === 'string' ? raw.provider : DEFAULT_PROVIDER)
  const root = repo.root
  // A task's run can give it to Claude, whatever the project's own agent (BTN-429, BTN-983).
  const trusted = root === null || unmade ? null : deps.claudeConfigs().some((config) => isTrusted(config, root, platform))
  return { repo, entry, yields, tracker, trusted, platform, user: deps.user, service: deps.service }
}

export async function checkRepo(
  git: Git,
  draft: ProjectDraft,
  raw: unknown,
  platform: NodeJS.Platform = process.platform,
  adapter?: TrackerAdapter,
  env: Readonly<Record<string, string | undefined>> = {},
  folders: Folders = REAL_FOLDERS,
  ownDir: string = projectsDir(),
  readRemote: ReadRemote = sharedRemoteReader,
): Promise<ProjectCheck['repo']> {
  const typed = draft.repo.trim()
  const none = { root: null, current: null, suggested: null, branches: null }
  const plain = draft.git === false
  if (!plain && draft.target !== undefined) {
    const resolved = await readTarget({ git, platform, folders, ownDir, projectOf: (folder) => projectOfRepo(raw, folder, platform) }, draft)
    const read = resolved.read === null ? {} : { read: resolved.read }
    if (resolved.draft === null) return { ...none, ...read, notice: resolved.notice }
    return { ...(await checkRepo(git, resolved.draft, raw, platform, adapter, env, folders, ownDir, readRemote)), ...read }
  }
  // A page that sends no `folder` for a project without git means Even Keel's own folder of the project, as before BTN-1048.
  if (plain ? typed === '' && draft.folder !== undefined : draft.source === 'clone' || draft.source === 'new') {
    const projectOf = (folder: string) => projectOfRepo(raw, folder, platform)
    return checkPlace({ git, platform, folders, ownDir, readRemote, projectOf, ...(adapter === undefined ? {} : { adapter }), env }, draft)
  }
  if (typed === '') return { ...none, root: plain ? ownDir : null, notice: null }
  const path = expandFolder(typed, folders.home, platform)
  const refuse = (code: 'wizard.noFolder' | 'wizard.relativePath') => ({ ...none, notice: notice(code, { path: typed }) })
  if (!isFullPath(path, platform)) return refuse(platform === 'win32' && /%[^%]+%/.test(path) ? 'wizard.noFolder' : 'wizard.relativePath')
  if (plain) {
    // The folder may lie inside a repository that is not the project's: git is not asked about it.
    const folder = pathsOf(platform).normalize(path)
    const taken = projectOfRepo(raw, folder, platform)
    return { ...none, root: folder, notice: taken === undefined ? null : notice('wizard.folderTaken', { project: taken }) }
  }
  if (!folders.isFolder(path)) return refuse('wizard.noFolder')
  const top = await git(path, ['rev-parse', '--show-toplevel'])
  if (top.missing === true) return { ...none, notice: notice('git.missing', {}) }
  if (top.code !== 0) return { ...none, notice: notice('wizard.notRepo', { path }, { detail: top.out }) }
  const root = pathsOf(platform).normalize(top.out.trim())
  const current = await currentBranch(git, root)
  const suggested = await suggestedOf(git, root, adapter, env)
  const found = { root, current, suggested, branches: null }
  const taken = projectOfRepo(raw, root, platform)
  if (taken !== undefined) return { ...found, notice: notice('wizard.repoTaken', { project: taken }) }
  const branches = await readBranches(git, root)
  // A fresh `git init` has a current branch that is not born yet: no commit, so no branch at all.
  if (branches !== null && !branches.branches.some((each) => each.remote === null)) return { ...found, notice: notice('wizard.noCommits', {}) }
  // A branch the repository lacks is no refusal: adding the project creates it (BTN-754).
  const branch = draft.branch.trim()
  if (branch !== '' && !(await isBranchName(git, root, branch))) return { ...found, branches, notice: notice('wizard.branchName', { value: branch }) }
  // Sessions commit and merge there: the folder's own config may name them where the global one does not.
  if (await lacksIdentity(git, root)) return { ...found, branches, notice: notice('git.noIdentity', {}) }
  return { ...found, branches, notice: null }
}

/**
 * The draft as "Create" builds it (BTN-1093): the wizard's one field read into the source, the remote and the folder
 * the creation's steps take; a draft without the field as it came. Refused as the check refuses it.
 */
export async function sourcedDraft(git: Git, draft: ProjectDraft, raw: unknown, platform: NodeJS.Platform = process.platform, folders: Folders = REAL_FOLDERS, ownDir: string = projectsDir()): Promise<ProjectDraft> {
  if (draft.git === false || draft.target === undefined) return draft
  const resolved = await readTarget({ git, platform, folders, ownDir, projectOf: (folder) => projectOfRepo(raw, folder, platform) }, draft)
  if (resolved.notice !== null) throw new NoticeError(resolved.notice)
  if (resolved.draft === null) throw fail('request.required', { field: 'target' })
  return resolved.draft
}

async function suggestedOf(git: Git, root: string, adapter: TrackerAdapter | undefined, env: Readonly<Record<string, string | undefined>>): Promise<string | null> {
  if (adapter?.projectOfRemote === undefined) return null
  const urls = await git(root, ['config', '--get-regexp', '^remote\\..*\\.url$'])
  if (urls.code !== 0) return null
  for (const { url } of remotesOf(urls.out)) {
    const remote = parseRemote(url)
    const place = remote === null ? undefined : adapter.projectOfRemote(remote, url, env)
    if (place !== undefined) return place
  }
  return null
}

/**
 * The config's refusal of the draft said the wizard's way, by the form's fields and without a path of the config
 * (BTN-297). A key may be shared (BTN-271) but not by another tracker project where the task ids are made of it (GitHub).
 */
function keyNotice(refused: Notice): Notice {
  switch (refused.code) {
    case 'config.keyElsewhere':
      return notice('wizard.keyTaken', { key: refused.params.key, project: refused.params.other })
    case 'config.projectKey':
      return notice('wizard.keyShape', { value: unquoted(refused.params.value) })
    case 'config.branch':
      return notice('wizard.branchName', { value: unquoted(refused.params.value) })
    case 'config.trackerProject':
      return notice('wizard.trackerPlace', { example: refused.params.example })
    case 'config.trackerProjectShared':
      return notice('wizard.trackerShared', { project: refused.params.other })
    default:
      return notice('wizard.entryFailed', {})
  }
}

/** A value the config quoted as JSON, as it was typed. */
function unquoted(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : value
  } catch {
    return value
  }
}

function projectOfRepo(raw: unknown, root: string, platform: NodeJS.Platform): string | undefined {
  const projects = isPlainObject(raw) && Array.isArray(raw.projects) ? (raw.projects as unknown[]) : []
  const found = projects.find((entry) => isPlainObject(entry) && typeof entry.repo === 'string' && samePath(entry.repo, root, platform))
  return isPlainObject(found) ? String(found.id) : undefined
}

/** Reads the project's tasks once, through its own connection, which is closed after. */
async function checkTracker(
  adapter: TrackerAdapter,
  deps: CheckDeps,
  key: string,
  place: string,
  rules: ChainRules,
  folder: { root: string; branch: string },
): Promise<NonNullable<ProjectCheck['tracker']>> {
  const failed = (notice: Notice) => ({ ok: false, missing: [], open: null, openToAll: false, notice })
  let setup
  try {
    setup = adapter.setup(deps.env, { [ENTRY_ID]: { key, ...(adapter.projectKey !== undefined && place !== '' ? { value: place } : {}) } })
  } catch (error) {
    return failed(noticeOf(error))
  }
  if (setup === undefined) {
    const variables = [...adapter.variables]
    return { ok: false, missing: variables, open: null, openToAll: false, notice: notice('wizard.trackerOff', { tracker: adapter.title, variables }) }
  }
  const connect = setup.connect
  const link = new TrackerLink({ name: adapter.title, connect: async () => trackerOf(await connect(deps.timeoutMs)), timeoutMs: deps.timeoutMs })
  try {
    const { tasks, isPublic, forge } = await link.run(async (tracker) => ({
      ...(await tracker.chainTasks(ENTRY_ID, rules)),
      isPublic: (await tracker.isPublic?.(ENTRY_ID)) ?? false,
      forge: tracker.isPublic !== undefined,
    }))
    const openToAll = isPublic && rules.requiredLabels.length === 0
    const hits = forge && rules.requiredLabels.length > 0 ? templateHits((await folderTemplates(deps.git, folder, place)) ?? [], rules.requiredLabels) : []
    return { ok: true, missing: [], open: tasks.filter((task) => isOpen(task.status)).length, openToAll, ...(hits.length > 0 && { templateHits: hits }), notice: null }
  } catch (error) {
    return failed(notice('wizard.trackerFailed', { tracker: adapter.title }, { detail: errorText(error) }))
  } finally {
    await link.close()
  }
}

/** The issue templates of the folder's branch, where the folder is a clone of the tracker's repository `place` (BTN-1130). */
async function folderTemplates(git: Git, { root, branch }: { root: string; branch: string }, place: string): Promise<IssueTemplate[] | null> {
  if (place === '') return null
  const urls = await git(root, ['config', '--get-regexp', '^remote\\..*\\.url$'])
  return urls.code === 0 && isOwnRepo(remotesOf(urls.out), place) ? readIssueTemplates(git, root, branch) : null
}

/** Whether `.claude.json` trusts the folder under a key the CLI reads. */
export function isTrusted(config: unknown, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  const projects = isPlainObject(config) && isPlainObject(config.projects) ? config.projects : {}
  return Object.entries(projects).some(([path, entry]) => readsKey(path, folder, platform) && isPlainObject(entry) && entry.hasTrustDialogAccepted === true)
}

/**
 * Whether the CLI started in `folder` reads its trust under `key`: the folder's real path (`workingFolder`), a key under
 * a link or junction to it does not count (EKR-94, EKR-96); on Windows in any case, with forward slashes only (EKR-92).
 */
export function readsKey(key: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32' && key.includes('\\')) return false
  return sameSpelling(key, workingFolder(folder, platform), platform)
}
