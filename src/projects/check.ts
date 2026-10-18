import type { ChainRules } from '../chain/rules.js'
import { withNewProject } from '../config-form.js'
import { DEFAULT_BRANCH, isPlainObject, parseConfig } from '../config.js'
import { hasBranch } from '../git/worktree.js'
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
  const repo = await checkRepo(deps.git, draft, raw, platform)
  const branch = draft.branch.trim() || repo.current || DEFAULT_BRANCH
  let entry: Notice | null = null
  let rules: ChainRules | undefined
  try {
    const config = parseConfig(withNewProject(raw, { ...draft, repo: repo.root ?? draft.repo, branch }, ENTRY_ID, deps.adapters), deps.adapters)
    rules = config.rules[draft.key.trim()]!
  } catch (error) {
    entry = noticeOf(error)
  }
  const adapter = deps.adapters[draft.tracker]
  const tracker =
    entry === null && rules !== undefined && adapter !== undefined && repo.root !== null && repo.notice === null
      ? await checkTracker(adapter, deps, draft.key.trim(), draft.trackerProject.trim(), rules)
      : null
  return { repo, entry, tracker, trusted: repo.root === null ? null : isTrusted(deps.claudeConfig(), repo.root, platform) }
}

async function checkRepo(git: Git, draft: ProjectDraft, raw: unknown, platform: NodeJS.Platform): Promise<ProjectCheck['repo']> {
  const path = draft.repo.trim()
  if (path === '') return { root: null, current: null, notice: null }
  const top = await git(path, ['rev-parse', '--show-toplevel'])
  if (top.code !== 0) return { root: null, current: null, notice: notice('wizard.notRepo', { path }, { detail: top.out }) }
  const root = pathsOf(platform).normalize(top.out.trim())
  const head = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const current = head.code === 0 && head.out.trim() !== '' ? head.out.trim() : null
  const taken = projectOfRepo(raw, root, platform)
  if (taken !== undefined) return { root, current, notice: notice('wizard.repoTaken', { project: taken }) }
  const branch = draft.branch.trim()
  if (branch !== '' && !(await hasBranch(git, root, branch))) return { root, current, notice: notice('wizard.noBranch', { branch }) }
  return { root, current, notice: null }
}

function projectOfRepo(raw: unknown, root: string, platform: NodeJS.Platform): string | undefined {
  const projects = isPlainObject(raw) && Array.isArray(raw.projects) ? (raw.projects as unknown[]) : []
  const found = projects.find((entry) => isPlainObject(entry) && typeof entry.repo === 'string' && samePath(entry.repo, root, platform))
  return isPlainObject(found) ? String(found.key) : undefined
}

/** Reads the project's tasks once, through its own connection, which is closed after. */
async function checkTracker(
  adapter: TrackerAdapter,
  deps: CheckDeps,
  key: string,
  place: string,
  rules: ChainRules,
): Promise<NonNullable<ProjectCheck['tracker']>> {
  const failed = (notice: Notice) => ({ ok: false, missing: [], open: null, notice })
  let setup
  try {
    setup = adapter.setup(deps.env, adapter.projectKey !== undefined && place !== '' ? { [key]: place } : {})
  } catch (error) {
    return failed(noticeOf(error))
  }
  if (setup === undefined) {
    const variables = [...adapter.variables]
    return { ok: false, missing: variables, open: null, notice: notice('wizard.trackerOff', { tracker: adapter.title, variables }) }
  }
  const connect = setup.connect
  const link = new TrackerLink({ name: adapter.title, connect: async () => trackerOf(await connect(deps.timeoutMs)), timeoutMs: deps.timeoutMs })
  try {
    const { tasks } = await link.run((tracker) => tracker.chainTasks(key, rules))
    return { ok: true, missing: [], open: tasks.filter((task) => isOpen(task.status)).length, notice: null }
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
