import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, ProfileField, ProfileKindView, ProfilesView, ProfileView } from '../../../src/state.js'
import type { TrackerProject } from '../../../src/tracker/source.js'
import { ago } from './fakeSessions.js'

/** The id of the fake Huly profile the fake projects run on. */
export const FAKE_HULY_PROFILE = '3f0c2b9e-0000-4000-8000-000000000001'
const GITHUB_PROFILE = '3f0c2b9e-0000-4000-8000-000000000002'
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
    alternatives: [['HULY_TOKEN'], ['HULY_EMAIL', 'HULY_PASSWORD']],
    help: 'https://github.com/hcengineering/platform/tree/develop/packages/api-client',
  },
  { kind: 'github', title: 'GitHub', fields: [{ name: 'GITHUB_TOKEN', secret: true }], hostVariables: [], alternatives: [], help: 'https://github.com/settings/personal-access-tokens/new' },
  { kind: 'linear', title: 'Linear', fields: [{ name: 'LINEAR_TOKEN', secret: true }], hostVariables: [], alternatives: [], help: 'https://linear.app/settings/account/security' },
]

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
  linear: [{ key: 'ENG', name: 'Engineering' }],
}

function fields(kind: string, values: Record<string, string>): ProfileField[] {
  return KINDS.find((each) => each.kind === kind)!.fields.map(({ name, secret }) => ({ name, secret, set: name in values, value: secret ? null : (values[name] ?? null) }))
}

/**
 * The trackers' profiles: Huly by default for the fake projects, a GitHub profile whose token runs out in 5 days and does
 * not reach the Actions of ABC's `github` remote. `?profiles=` — `none`: no profiles, `refused`: Huly refuses its token.
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
    hiddenCi: [],
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
    projects: [],
    hiddenCi: [{ project: 'ABC', remote: 'github' }],
  }
  return { profiles: [huly, github], kinds: KINDS }
}

export function fakeProfilesCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (!name.startsWith('profiles/')) return null
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
  if (name === 'profiles/link') {
    const project = String(body.project)
    const profiles = view.profiles.map((each) => ({
      ...each,
      projects: each.id === body.profile ? [...each.projects.filter((key) => key !== project), project] : each.projects.filter((key) => key !== project),
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
    hiddenCi: stored?.hiddenCi ?? [],
  }
  const profiles = stored === undefined ? [...view.profiles, profile] : view.profiles.map((each) => (each.id === id ? profile : each))
  return { ...state, profiles: { ...view, profiles } }
}
