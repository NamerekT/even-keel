import { fail, notice, NoticeError } from '../../../src/notice/notice.js'
import type { EvenKeelState, FeedView, ProjectCheck, ProjectDraft, ProjectForm } from '../../../src/state.js'
import { DEFAULT_RULES } from '../../../src/chain/rules.js'
import { colorsOf } from '../../../src/projects/colors.js'
import { fakeProjectMaps } from './fakeConfig.js'

const ownColors = (forms: Record<string, ProjectForm>): Record<string, number> =>
  Object.fromEntries(Object.entries(forms).flatMap(([key, form]) => (form.color === null ? [] : [[key, form.color]])))

const BRANCHES = ['main', 'master', 'develop']
const KEY = /^[A-Z][A-Z0-9_]{0,4}$/

/** `?projects=none` — the config has no projects yet: the first start, before the wizard. */
export function fakeNoProjects(state: EvenKeelState): EvenKeelState {
  return {
    ...state,
    projects: [],
    ...fakeProjectMaps({}),
    config: { ...state.config, projects: {}, feeds: {}, trackerLocked: [] },
    chain: { ...state.chain, active: [], queue: [], projects: {}, skipped: {}, leftovers: {} },
    tasks: [],
    sessions: [],
    ci: {},
    remotes: {},
    sameRepository: {},
    pullReadiness: {},
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
  const host = { platform: 'win32', user: 'EvenKeelSvc' }
  if (path === '') return { repo: { ...none, notice: null }, entry: null, yields: [], tracker: null, trusted: null, ...host }
  if (path.includes('nope')) {
    return { repo: { ...none, notice: notice('wizard.notRepo', { path }, { detail: 'fatal: not a git repository' }) }, entry: null, yields: [], tracker: null, trusted: null, ...host }
  }
  const root = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const current = root.includes('master') ? 'master' : 'main'
  const suggested = draft.tracker === 'github' ? `octo-org/${root.split('/').pop()}` : null
  const repo = { root, current, suggested, notice: repoNotice(state, root, draft.branch.trim()) }
  const shared = sharedWith(state, draft)
  const entry = entryNotice(state, draft) ?? (shared.length > 0 && draft.milestones.length === 0 ? notice('wizard.trackerShared', { project: shared[0]! }) : null)
  const yields = entry === null && draft.milestones.length > 0 ? shared : []
  // Only a Claude project is asked about the folder's trust (BTN-310).
  const claude = (draft.provider ?? state.config.shared.provider) === 'claude'
  const trusted = claude ? mode !== 'untrusted' : null
  if (entry !== null || repo.notice !== null) return { repo, entry, yields, tracker: null, trusted, ...host }
  return { repo, entry, yields, tracker: trackerOf(draft.tracker, mode), trusted, ...host }
}

/** The labels of the Huly projects that read the draft's Huly project: its own value, or its key. */
function sharedWith(state: EvenKeelState, draft: ProjectDraft): string[] {
  if (draft.tracker !== 'huly') return []
  const place = draft.trackerProject.trim() || draft.key.trim()
  return state.projects
    .filter((project) => {
      const form = state.config.projects[project]
      return form?.tracker === 'huly' && (form.trackerProject ?? state.projectKeys[project]) === place
    })
    .map((project) => state.projectLabels[project] ?? project)
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
  // Projects may share a key (BTN-271), but not on GitHub with another repository: the task ids of both would be the same.
  if (draft.tracker !== 'github' && draft.tracker !== 'gitlab') return null
  const repo = draft.trackerProject.trim() || null
  const other = state.projects.find((project) => {
    const form = state.config.projects[project]
    return state.projectKeys[project] === key && form?.tracker === draft.tracker && form.trackerProject !== repo
  })
  return other === undefined ? null : notice('wizard.keyTaken', { key, project: state.projectLabels[other] ?? other })
}

function trackerOf(name: string, mode: string | null): ProjectCheck['tracker'] {
  const title = name === 'github' ? 'GitHub' : name === 'linear' ? 'Linear' : name === 'gitlab' ? 'GitLab' : 'Huly'
  if (mode === 'off') {
    const variables = name === 'github' ? ['GITHUB_TOKEN'] : name === 'linear' ? ['LINEAR_API_KEY'] : name === 'gitlab' ? ['GITLAB_TOKEN'] : ['HULY_URL', 'HULY_EMAIL', 'HULY_PASSWORD', 'HULY_WORKSPACE']
    return { ok: false, missing: variables, open: null, openToAll: false, notice: notice('wizard.trackerOff', { tracker: title, variables }) }
  }
  if (mode === 'failed') {
    return { ok: false, missing: [], open: null, openToAll: false, notice: notice('wizard.trackerFailed', { tracker: title }, { detail: 'connect ETIMEDOUT 10.0.0.5:443' }) }
  }
  // The fake GitHub repository is public: the wizard shows its warning.
  return { ok: true, missing: [], open: 7, openToAll: name === 'github' || name === 'gitlab', notice: null }
}

/** `project/add` puts the draft in as the service would, `project/remove` refuses a project whose chain runs. */
export function fakeProjectCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (name === 'project/add') return withProject(state, body as unknown as ProjectDraft)
  if (name === 'project/feed/add' || name === 'project/feed/remove') return withFeeds(state, name, body)
  if (name !== 'project/remove') return null
  const id = String(body.project)
  if (!state.projects.includes(id)) throw fail('config.unknownProject', { key: id })
  if (state.chain.active.some((chain) => chain.project === id) || state.chain.queue.includes(id)) {
    throw new NoticeError(notice('project.removeBlocked', { project: id }, { items: [notice('project.removeChain', {})] }))
  }
  const { [id]: _form, ...projects } = state.config.projects
  const { [id]: _key, ...keys } = state.projectKeys
  return { ...state, projects: state.projects.filter((each) => each !== id), ...mapsOf(keys, projects), config: { ...state.config, projects } }
}

/** `project/feed/add` refuses a key that is no project key or that a project or feed already gives; a locked feed can still go. */
function withFeeds(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState {
  const project = String(body.project)
  const feeds = state.config.feeds[project] ?? []
  const next = (list: FeedView[]): EvenKeelState => {
    const { [project]: _, ...rest } = state.config.feeds
    return { ...state, config: { ...state.config, feeds: list.length === 0 ? rest : { ...rest, [project]: list } } }
  }
  if (name === 'project/feed/remove') {
    if (!feeds.some((feed) => feed.id === body.feed)) throw fail('config.unknownFeed', {})
    return next(feeds.filter((feed) => feed.id !== body.feed))
  }
  const key = String(body.key).trim()
  if (!KEY.test(key)) throw fail('config.projectKey', { where: `${state.projectKeys[project] ?? project}.feeds[${feeds.length}].key`, value: key })
  const taken = [...Object.values(state.projectKeys), ...Object.values(state.config.feeds).flat().map((feed) => feed.key)]
  if (taken.includes(key)) throw fail('config.feedPrefix', { project: state.projectLabels[project] ?? project, prefix: key, other: key })
  const place = typeof body.place === 'string' && body.place.trim() !== '' ? body.place.trim() : undefined
  return next([...feeds, { id: crypto.randomUUID(), tracker: String(body.tracker), key, ...(place === undefined ? {} : { place }) }])
}

const mapsOf = (keys: Record<string, string>, forms: Record<string, ProjectForm>) =>
  fakeProjectMaps(keys, Object.fromEntries(Object.entries(forms).map(([project, form]) => [project, form.name ?? form.branch])))

function withProject(state: EvenKeelState, draft: ProjectDraft): EvenKeelState {
  const key = draft.key.trim()
  // A fake project's id is its key, but for one whose key another project has.
  const id = state.projects.includes(key) ? crypto.randomUUID() : key
  const form: ProjectForm = {
    name: draft.name.trim() || null,
    repo: draft.repo.trim().replace(/\\/g, '/'),
    branch: draft.branch.trim() || 'main',
    tracker: draft.tracker,
    trackerProject: draft.trackerProject.trim() || null,
    slot: draft.slot,
    color: colorsOf([...state.projects, id], ownColors(state.config.projects))[id] ?? null,
    brief: state.config.shared.brief,
    chain: { ...DEFAULT_RULES, requiredMilestones: draft.milestones },
    ownRules: draft.milestones.length > 0 ? ['requiredMilestones'] : [],
    prompt: null,
    beforeStart: [],
    check: [],
    afterGreen: [],
    ci: state.config.shared.ci,
    remoteProfiles: {},
    pullRequests: false,
    intakeLabel: null,
    mergeInto: null,
    carryAgent: false,
    fillMilestone: state.config.shared.fillMilestone,
    changelog: 'CHANGELOG.md',
    standards: [],
    provider: null,
    models: {},
    accounts: {},
    modelLabels: null,
    promptLanguage: state.config.shared.promptLanguage,
    cacheTtl: state.config.shared.cacheTtl,
    checkpointTokens: state.config.shared.stats.checkpointTokens,
    checkpointShares: state.config.shared.stats.checkpointShares,
    own: {},
  }
  const projects = { ...state.config.projects, [id]: form }
  return {
    ...state,
    projects: [...state.projects, id],
    ...mapsOf({ ...state.projectKeys, [id]: key }, projects),
    config: { ...state.config, projects },
    chain: { ...state.chain, projects: { ...state.chain.projects, [id]: { order: [], waiting: [], backlog: [], error: null } } },
  }
}
