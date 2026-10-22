import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProfileField, ProfileKindView, ProfilesView, ProfileView } from '../../../src/state.js'
import type { TrackerProject } from '../../../src/tracker/source.js'
import { ago } from './fakeSessions.js'

/** The id of the fake Huly profile the fake projects run on. */
export const FAKE_HULY_PROFILE = '3f0c2b9e-0000-4000-8000-000000000001'
/** The id of the fake GitHub profile, XYZ's choice for its github.com remote. */
export const GITHUB_PROFILE = '3f0c2b9e-0000-4000-8000-000000000002'
const DAY_MS = 86_400_000

const KINDS: ProfileKindView[] = [
  {
    kind: 'huly',
    title: 'Huly',
    fields: [
      { name: 'HULY_URL', secret: false },
      { name: 'HULY_WORKSPACE', secret: false },
      { name: 'HULY_TOKEN', secret: true },
      { name: 'HULY_EMAIL', secret: false },
      { name: 'HULY_PASSWORD', secret: true },
    ],
    hostVariables: ['HULY_URL', 'HULY_WORKSPACE'],
    alternatives: [['HULY_EMAIL', 'HULY_PASSWORD'], ['HULY_TOKEN']],
    help: 'https://github.com/NamerekT/even-keel/blob/main/plugins/huly/README.md#credentials',
    tracker: true,
  },
  { kind: 'github', title: 'GitHub', tracker: true, fields: [{ name: 'GITHUB_TOKEN', secret: true }], hostVariables: [], alternatives: [], help: 'https://github.com/settings/personal-access-tokens/new' },
  { kind: 'linear', title: 'Linear', tracker: true, fields: [{ name: 'LINEAR_TOKEN', secret: true }], hostVariables: [], alternatives: [], help: 'https://linear.app/settings/account/security' },
  {
    kind: 'forgejo',
    title: 'Forgejo',
    tracker: false,
    fields: [
      { name: 'FORGEJO_URL', secret: false },
      { name: 'FORGEJO_TOKEN', secret: true },
    ],
    hostVariables: ['FORGEJO_URL'],
    alternatives: [],
    help: 'https://forgejo.org/docs/latest/user/token-scope/',
  },
]
const FORGEJO_PROFILE = '3f0c2b9e-0000-4000-8000-000000000003'

const PROJECTS: Record<string, TrackerProject[]> = {
  huly: [
    { key: 'ABC', name: 'Example app' },
    { key: 'DEMO', name: 'Demo' },
    { key: 'XYZ', name: 'Sandbox' },
    { key: 'OPS', name: 'Operations' },
    { key: 'DOCS', name: 'Documentation' },
  ],
  github: [
    { key: 'octo-org/example', name: 'example' },
    { key: 'octo-org/website', name: 'website' },
  ],
  linear: [
    { key: 'ENG', name: 'Engineering' },
    { key: 'ENG', name: 'Web app', within: 'Web app' },
    { key: 'OPS', name: 'Operations' },
  ],
}
export const LINEAR_PROFILE = '3f0c2b9e-0000-4000-8000-000000000004'

function fields(kind: string, values: Record<string, string>): ProfileField[] {
  return KINDS.find((each) => each.kind === kind)!.fields.map(({ name, secret }) => ({ name, secret, set: name in values, value: secret ? null : (values[name] ?? null) }))
}

/**
 * The profiles: Huly by default for the fake projects, a GitHub profile whose token runs out in 5 days and does not reach
 * the Actions of ABC's `github` remote, and a Forgejo profile ABC's and DEMO's `origin` CI takes. `?profiles=` — `none`:
 * no profiles, `refused`: Huly refuses its token, `all`: a Linear profile too, `github`: the GitHub and the Forgejo one only.
 */
export function fakeProfiles(mode: string | null): ProfilesView {
  if (mode === 'none') return { profiles: [], kinds: KINDS }
  const huly: ProfileView = {
    id: FAKE_HULY_PROFILE,
    kind: 'huly',
    name: 'Huly · example',
    isDefault: true,
    fields: fields('huly', { HULY_URL: 'https://huly.example.com', HULY_WORKSPACE: 'example', HULY_TOKEN: '' }),
    login: 'john.doe@example.com',
    expiresAt: null,
    check:
      mode === 'refused'
        ? { state: 'refused', error: notice('profiles.refused', { tracker: 'Huly' }), at: ago(3) }
        : { state: 'ok', error: null, at: ago(3) },
    projects: ['ABC', 'DEMO', 'XYZ', 'OPS'],
    ci: [],
    hiddenCi: [],
    deniedPulls: [],
    rules: { terminal: ['Done', 'Canceled'] },
    projectIds: ['ABC', 'DEMO', 'XYZ', 'OPS'],
  }
  const github: ProfileView = {
    id: GITHUB_PROFILE,
    kind: 'github',
    name: 'GitHub · octo-org',
    isDefault: true,
    fields: fields('github', { GITHUB_TOKEN: '' }),
    login: 'johndoe',
    expiresAt: new Date(Date.now() + 5 * DAY_MS).toISOString(),
    check: { state: 'ok', error: null, at: ago(3) },
    projects: ['ABCGH'],
    ci: [],
    hiddenCi: [{ project: 'ABC', remote: 'github' }],
    deniedPulls: [],
    rules: {},
    projectIds: ['feed-abc-gh'],
  }
  const forgejo: ProfileView = {
    id: FORGEJO_PROFILE,
    kind: 'forgejo',
    name: 'Forgejo · git.example.com',
    isDefault: true,
    fields: fields('forgejo', { FORGEJO_URL: 'https://git.example.com', FORGEJO_TOKEN: '' }),
    login: 'johndoe',
    expiresAt: null,
    check: { state: 'ok', error: null, at: ago(3) },
    projects: [],
    ci: [
      { project: 'ABC', remote: 'origin' },
      { project: 'DEMO', remote: 'origin' },
    ],
    hiddenCi: [],
    deniedPulls: [{ project: 'DEMO', remote: 'origin' }],
    rules: {},
    projectIds: [],
  }
  const linear: ProfileView = {
    id: LINEAR_PROFILE,
    kind: 'linear',
    name: 'Linear · example',
    isDefault: true,
    fields: fields('linear', { LINEAR_TOKEN: '' }),
    login: 'John Doe',
    expiresAt: null,
    check: { state: 'ok', error: null, at: ago(3) },
    projects: ['WEB'],
    ci: [],
    hiddenCi: [],
    deniedPulls: [],
    rules: {},
    projectIds: ['feed-abc-lin'],
  }
  if (mode === 'github') return { profiles: [github, forgejo], kinds: KINDS }
  return { profiles: mode === 'all' ? [huly, github, linear, forgejo] : [huly, github, forgejo], kinds: KINDS }
}

export function fakeProfilesCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (!name.startsWith('profiles/') && name !== 'project/feed/profile') return null
  const view = state.profiles
  const id = String(body.id ?? body.profile)
  const profile = view.profiles.find((each) => each.id === id)
  if (name === 'profiles/remove') {
    if (profile !== undefined && profile.projects.length > 0) throw fail('profiles.inUse', { profile: profile.name, projects: profile.projects.join(', ') })
    return { ...state, profiles: { ...view, profiles: view.profiles.filter((each) => each.id !== id) } }
  }
  if (name === 'profiles/default' && profile !== undefined) {
    const profiles = view.profiles.map((each) => (each.kind === profile.kind ? { ...each, isDefault: each.id === id } : each))
    return { ...state, profiles: { ...view, profiles } }
  }
  if (name === 'profiles/rules' && profile !== undefined) {
    const rules = body.rules as ProfileView['rules']
    if (rules.terminal?.some((status) => status.toLowerCase() === 'todo')) throw fail('config.statusBoth', { project: 'ABC', status: 'Todo' })
    return { ...state, profiles: { ...view, profiles: view.profiles.map((each) => (each.id === id ? { ...each, rules } : each)) } }
  }
  if (name === 'profiles/link' || name === 'project/feed/profile') {
    const project = String(name === 'profiles/link' ? body.project : body.feed)
    const key = name === 'profiles/link' ? project : (Object.values(state.config.feeds).flat().find((feed) => feed.id === project)?.key ?? project)
    const kind = name === 'profiles/link' ? state.config.projects[project]?.tracker : Object.values(state.config.feeds).flat().find((feed) => feed.id === project)?.tracker
    const on = (each: ProfileView) => (body.profile === null ? each.kind === kind && each.isDefault : each.id === body.profile)
    const profiles = view.profiles.map((each) => ({
      ...each,
      projects: on(each) ? [...each.projects.filter((other) => other !== key), key] : each.projects.filter((other) => other !== key),
      projectIds: on(each) ? [...each.projectIds.filter((other) => other !== project), project] : each.projectIds.filter((other) => other !== project),
    }))
    return { ...state, profiles: { ...view, profiles } }
  }
  throw new Error(`fake: ${name} is not supported`)
}

/** `profiles/check` signs in as long as the secret does not start with `bad`; a second Huly profile is a duplicate. */
export function fakeProfilesQuery(state: EvenKeelState, name: string, body: Record<string, unknown>): unknown {
  const kind = String(body.kind)
  const title = KINDS.find((each) => each.kind === kind)?.title ?? kind
  const values = (body.values ?? {}) as Record<string, string | null>
  if (name === 'profiles/projects') {
    const profile = state.profiles.profiles.find((each) => each.id === body.id)
    const query = String(body.query ?? '').toLowerCase()
    return (PROJECTS[profile?.kind ?? ''] ?? []).filter((each) => `${each.key} ${each.name}`.toLowerCase().includes(query))
  }
  if (Object.values(values).some((value) => value?.startsWith('bad'))) throw fail('profiles.refused', { tracker: title })
  const login = kind === 'huly' ? (values.HULY_EMAIL || 'john.doe@example.com') : 'johndoe'
  const named = kind === 'huly' ? `Huly · ${values.HULY_WORKSPACE || 'example'}` : `${title} · ${login}`
  if (name === 'profiles/check') {
    const duplicate = state.profiles.profiles.find((each) => each.kind === kind && each.login === login && each.id !== body.id)
    return { login, name: named, expiresAt: kind === 'github' ? new Date(Date.now() + 30 * DAY_MS).toISOString() : null, duplicate: duplicate?.name ?? null }
  }
  if (name === 'profiles/save') return { id: typeof body.id === 'string' ? body.id : crypto.randomUUID() }
  throw new Error(`fake: ${name} is not supported`)
}

/** The state after a fake `profiles/save` answered `id`. */
export function fakeSaved(state: EvenKeelState, id: string, body: Record<string, unknown>): EvenKeelState {
  const view = state.profiles
  const kind = String(body.kind)
  const values = Object.fromEntries(Object.entries((body.values ?? {}) as Record<string, string | null>).filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== ''))
  const stored = view.profiles.find((each) => each.id === id)
  const profile: ProfileView = {
    id,
    kind,
    name: String(body.name),
    isDefault: stored?.isDefault ?? !view.profiles.some((each) => each.kind === kind),
    fields: stored?.fields.map((field) => (field.name in values ? { ...field, set: true, value: field.secret ? null : values[field.name]! } : field)) ?? fields(kind, values),
    login: kind === 'huly' ? (values.HULY_EMAIL ?? 'john.doe@example.com') : 'johndoe',
    expiresAt: kind === 'github' ? new Date(Date.now() + 30 * DAY_MS).toISOString() : null,
    check: { state: 'ok', error: null, at: ago(0) },
    projects: stored?.projects ?? [],
    ci: stored?.ci ?? [],
    hiddenCi: stored?.hiddenCi ?? [],
    deniedPulls: [],
    rules: stored?.rules ?? {},
    projectIds: stored?.projectIds ?? [],
  }
  const profiles = stored === undefined ? [...view.profiles, profile] : view.profiles.map((each) => (each.id === id ? profile : each))
  return { ...state, profiles: { ...view, profiles } }
}
