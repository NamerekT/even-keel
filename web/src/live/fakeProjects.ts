import { fail, notice, NoticeError } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProjectCheck, ProjectDraft, ProjectForm } from '../../../src/state.js'
import { DEFAULT_RULES } from '../../../src/chain/rules.js'
import { colorsOf } from '../../../src/projects/colors.js'

const ownColors = (forms: Record<string, ProjectForm>): Record<string, number> =>
  Object.fromEntries(Object.entries(forms).flatMap(([key, form]) => (form.color === null ? [] : [[key, form.color]])))

const BRANCHES = ['main', 'master', 'develop']
const KEY = /^[A-Z][A-Z0-9_]{0,4}$/

/** `?projects=none` — the config has no projects yet: the first start, before the wizard. */
export function fakeNoProjects(state: EvenKeelState): EvenKeelState {
  return {
    ...state,
    projects: [],
    projectIds: {},
    config: { ...state.config, projects: {}, trackerLocked: [] },
    chain: { ...state.chain, active: [], queue: [], projects: {}, skipped: {}, leftovers: {} },
    tasks: [],
    sessions: [],
    ci: {},
    remotes: {},
    taskSessions: {},
    fixes: {},
    launches: [],
  }
}

/**
 * The wizard's check by the fake's rules: a path with `nope` is not a repository, one with `master` is on that branch,
 * a branch outside main/master/develop is missing; `?wizard=untrusted|off|failed` — the folder is not trusted,
 * the tracker has no variables, the tracker does not answer.
 */
export function fakeCheck(state: EvenKeelState, draft: ProjectDraft, mode: string | null): ProjectCheck {
  const path = draft.repo.trim()
  const none = { root: null, current: null, suggested: null }
  if (path === '') return { repo: { ...none, notice: null }, entry: null, tracker: null, trusted: null }
  if (path.includes('nope')) return { repo: { ...none, notice: notice('wizard.notRepo', { path }, { detail: 'fatal: not a git repository' }) }, entry: null, tracker: null, trusted: null }
  const root = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const current = root.includes('master') ? 'master' : 'main'
  const suggested = draft.tracker === 'github' ? `octo-org/${root.split('/').pop()}` : null
  const repo = { root, current, suggested, notice: repoNotice(state, root, draft.branch.trim()) }
  const entry = entryNotice(state, draft)
  const trusted = mode !== 'untrusted'
  if (entry !== null || repo.notice !== null) return { repo, entry, tracker: null, trusted }
  return { repo, entry, tracker: trackerOf(draft.tracker, mode), trusted }
}

function repoNotice(state: EvenKeelState, root: string, branch: string): ProjectCheck['repo']['notice'] {
  const taken = Object.entries(state.config.projects).find(([, form]) => form.repo.toLowerCase() === root.toLowerCase())
  if (taken !== undefined) return notice('wizard.repoTaken', { project: taken[0] })
  if (branch !== '' && !BRANCHES.includes(branch)) return notice('wizard.noBranch', { branch, branches: BRANCHES })
  return null
}

function entryNotice(state: EvenKeelState, draft: ProjectDraft): ProjectCheck['entry'] {
  const key = draft.key.trim()
  const where = `projects[${state.projects.length}]`
  if (!KEY.test(key)) return notice('config.projectKey', { where: `${where}.key`, value: key })
  const first = state.projects.indexOf(key)
  if (first !== -1) return notice('config.projectTwice', { field: 'key', value: key, first: `projects[${first}]`, second: where })
  return null
}

function trackerOf(name: string, mode: string | null): ProjectCheck['tracker'] {
  const title = name === 'github' ? 'GitHub' : name === 'linear' ? 'Linear' : 'Huly'
  if (mode === 'off') {
    const variables = name === 'github' ? ['GITHUB_TOKEN'] : name === 'linear' ? ['LINEAR_API_KEY'] : ['HULY_URL', 'HULY_EMAIL', 'HULY_PASSWORD', 'HULY_WORKSPACE']
    return { ok: false, missing: variables, open: null, notice: notice('wizard.trackerOff', { tracker: title, variables }) }
  }
  if (mode === 'failed') return { ok: false, missing: [], open: null, notice: notice('wizard.trackerFailed', { tracker: title }, { detail: 'connect ETIMEDOUT 10.0.0.5:443' }) }
  return { ok: true, missing: [], open: 7, notice: null }
}

/** `project/add` puts the draft in as the service would, `project/remove` refuses a project whose chain runs. */
export function fakeProjectCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (name === 'project/add') return withProject(state, body as unknown as ProjectDraft)
  if (name !== 'project/remove') return null
  const key = String(body.project)
  if (!state.projects.includes(key)) throw fail('config.unknownProject', { key })
  if (state.chain.active.some((chain) => chain.project === key) || state.chain.queue.includes(key)) {
    throw new NoticeError(notice('project.removeBlocked', { project: key }, { items: [notice('project.removeChain', {})] }))
  }
  const { [key]: _form, ...projects } = state.config.projects
  const { [key]: _id, ...projectIds } = state.projectIds
  return { ...state, projects: state.projects.filter((each) => each !== key), projectIds, config: { ...state.config, projects } }
}

function withProject(state: EvenKeelState, draft: ProjectDraft): EvenKeelState {
  const key = draft.key.trim()
  const form: ProjectForm = {
    name: draft.name.trim() || null,
    repo: draft.repo.trim().replace(/\\/g, '/'),
    branch: draft.branch.trim() || 'main',
    tracker: draft.tracker,
    trackerProject: draft.trackerProject.trim() || null,
    slot: draft.slot,
    color: colorsOf([...state.projects, key], ownColors(state.config.projects))[key] ?? null,
    brief: state.config.shared.brief,
    chain: DEFAULT_RULES,
    prompt: null,
    beforeStart: [],
    check: [],
    afterGreen: [],
    ci: { guard: true, kinds: [], waitMinutes: null, recheckMain: true, fixTask: false },
    remoteProfiles: {},
    pullRequests: false,
    fillMilestone: false,
    changelog: 'CHANGELOG.md',
    provider: null,
    models: {},
    accounts: {},
    modelLabels: null,
  }
  return {
    ...state,
    projects: [...state.projects, key],
    projectIds: { ...state.projectIds, [key]: crypto.randomUUID() },
    config: { ...state.config, projects: { ...state.config.projects, [key]: form } },
    chain: { ...state.chain, projects: { ...state.chain.projects, [key]: { order: [], waiting: [], backlog: [], error: null } } },
  }
}
