import type { ChainRules } from '../chain/rules.js'
import { parseRemote, remotesOf } from '../ci/remote.js'
import { withNewProject } from '../config-form.js'
import { DEFAULT_BRANCH, isPlainObject, parseConfig } from '../config.js'
import type { Git } from '../git/types.js'
import { notice, noticeOf, type Notice } from '../notice/notice.js'
import { pathsOf, samePath } from '../paths.js'
import type { ProjectCheck, ProjectDraft } from '../state.js'
import { errorText, TrackerLink } from '../tracker/link.js'
import { isOpen } from '../tracker/model.js'
import { trackerOf, type TrackerAdapter } from '../tracker/source.js'

export interface CheckDeps {
  git: Git
  /** The config file as it is now. */
  raw: () => unknown
  adapters: Readonly<Record<string, TrackerAdapter>>
  /** The values of the tracker profile the draft would run on. */
  env: Record<string, string | undefined>
  /** The global `.claude.json`, whose trust the account folders get; `undefined` — none. */
  claudeConfig: () => unknown
  timeoutMs: number
  platform?: NodeJS.Platform
}

const ENTRY_ID = 'wizard-check'

/**
 * What the wizard's draft would come to: the repository and its branch, the config with the draft added, the tracker's
 * answer for the project and Claude Code's trust in the folder. Each step that needs an earlier one is left `null`
 * until that one passes.
 */
export async function checkDraft(deps: CheckDeps, draft: ProjectDraft): Promise<ProjectCheck> {
  const platform = deps.platform ?? process.platform
  const raw = deps.raw()
  const adapter = deps.adapters[draft.tracker]
  const repo = await checkRepo(deps.git, draft, raw, platform, adapter)
  const branch = draft.branch.trim() || repo.current || DEFAULT_BRANCH
  let entry: Notice | null = null
  let rules: ChainRules | undefined
  try {
    const config = parseConfig(withNewProject(raw, { ...draft, repo: repo.root ?? draft.repo, branch }, ENTRY_ID, deps.adapters), deps.adapters)
    rules = config.rules[ENTRY_ID]!
  } catch (error) {
    entry = keyNotice(noticeOf(error))
  }
  const tracker =
    entry === null && rules !== undefined && adapter !== undefined && repo.root !== null && repo.notice === null
      ? await checkTracker(adapter, deps, draft.key.trim(), draft.trackerProject.trim(), rules)
      : null
  return { repo, entry, tracker, trusted: repo.root === null ? null : isTrusted(deps.claudeConfig(), repo.root, platform), platform }
}

async function checkRepo(
  git: Git,
  draft: ProjectDraft,
  raw: unknown,
  platform: NodeJS.Platform,
  adapter: TrackerAdapter | undefined,
): Promise<ProjectCheck['repo']> {
  const path = draft.repo.trim()
  if (path === '') return { root: null, current: null, suggested: null, notice: null }
  const top = await git(path, ['rev-parse', '--show-toplevel'])
  if (top.code !== 0) return { root: null, current: null, suggested: null, notice: notice('wizard.notRepo', { path }, { detail: top.out }) }
  const root = pathsOf(platform).normalize(top.out.trim())
  const head = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const current = head.code === 0 && head.out.trim() !== '' ? head.out.trim() : null
  const suggested = await suggestedOf(git, root, adapter)
  const taken = projectOfRepo(raw, root, platform)
  if (taken !== undefined) return { root, current, suggested, notice: notice('wizard.repoTaken', { project: taken }) }
  const branches = await branchesOf(git, root)
  // A fresh `git init` has a current branch that is not born yet: no commit, so no branch at all.
  if (branches?.length === 0) return { root, current, suggested, notice: notice('wizard.noCommits', {}) }
  const branch = draft.branch.trim()
  if (branch !== '' && branches !== null && !branches.includes(branch)) return { root, current, suggested, notice: notice('wizard.noBranch', { branch, branches }) }
  return { root, current, suggested, notice: null }
}

/** The local branches; `null` when git cannot list them. */
async function branchesOf(git: Git, root: string): Promise<string[] | null> {
  const listed = await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
  if (listed.code !== 0) return null
  return listed.out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

async function suggestedOf(git: Git, root: string, adapter: TrackerAdapter | undefined): Promise<string | null> {
  if (adapter?.projectOfRemote === undefined) return null
  const urls = await git(root, ['config', '--get-regexp', '^remote\\..*\\.url$'])
  if (urls.code !== 0) return null
  for (const { url } of remotesOf(urls.out)) {
    const remote = parseRemote(url)
    const place = remote === null ? undefined : adapter.projectOfRemote(remote)
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
    const { tasks, isPublic } = await link.run(async (tracker) => ({
      ...(await tracker.chainTasks(ENTRY_ID, rules)),
      isPublic: (await tracker.isPublic?.(ENTRY_ID)) ?? false,
    }))
    const openToAll = isPublic && rules.requiredLabels.length === 0
    return { ok: true, missing: [], open: tasks.filter((task) => isOpen(task.status)).length, openToAll, notice: null }
  } catch (error) {
    return failed(notice('wizard.trackerFailed', { tracker: adapter.title }, { detail: errorText(error) }))
  } finally {
    await link.close()
  }
}

/** Whether `.claude.json` trusts the folder under any spelling of its path the CLI wrote. */
export function isTrusted(config: unknown, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  const projects = isPlainObject(config) && isPlainObject(config.projects) ? config.projects : {}
  return Object.entries(projects).some(([path, entry]) => samePath(path, folder, platform) && isPlainObject(entry) && entry.hasTrustDialogAccepted === true)
}
