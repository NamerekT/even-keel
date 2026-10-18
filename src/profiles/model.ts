import type { TrackerAdapter } from '../tracker/source.js'

/**
 * A tracker profile (BTN-200): one set of credentials of one tracker. A project runs on one profile of its tracker; two
 * projects of the same tracker may run on two profiles (a personal GitHub token and an organization's).
 */
export interface TrackerProfile {
  /** A GUID. */
  id: string
  /** The adapter's name: `huly`, `github`, `linear`. */
  kind: string
  name: string
  /** The credentials by the adapter's variable names (`HULY_URL`, `GITHUB_TOKEN`): what its `setup` reads. */
  values: Record<string, string>
  /** The kind's profile for the sessions started by hand, the GitHub Actions of other trackers' projects and new projects. */
  isDefault: boolean
  /** Whom the last check signed in as; `null` — never checked. */
  login: string | null
  /** When the credentials expire, as the tracker said at the last check; `null` — it did not say. */
  expiresAt: string | null
}

export interface ProfileSet {
  /** In the order they were made. */
  profiles: TrackerProfile[]
  /** The profile each project chose, by project id; a project without one runs on its tracker's default profile. */
  links: Record<string, string>
}

export type Adapters = Readonly<Record<string, TrackerAdapter>>

/** The profile a project runs on: the one it chose while that is of the project's tracker, else the tracker's default. */
export function profileFor(set: ProfileSet, projectId: string | undefined, kind: string): TrackerProfile | undefined {
  const linked = projectId === undefined ? undefined : set.profiles.find((profile) => profile.id === set.links[projectId])
  return linked?.kind === kind ? linked : defaultProfile(set, kind)
}

export const defaultProfile = (set: ProfileSet, kind: string): TrackerProfile | undefined =>
  set.profiles.find((profile) => profile.kind === kind && profile.isDefault)

/**
 * The keys a project's MCP servers take (BTN-200): the environment without any tracker's variables, then each tracker's
 * default profile, then the profile the project runs on — its tracker server signs in as that one.
 */
export function keyPool(set: ProfileSet, adapters: Adapters, env: NodeJS.ProcessEnv, projectId: string | undefined, kind: string): NodeJS.ProcessEnv {
  const pool: NodeJS.ProcessEnv = { ...env }
  for (const adapter of Object.values(adapters)) for (const name of adapter.variables) delete pool[name]
  for (const profile of set.profiles) if (profile.isDefault) Object.assign(pool, profile.values)
  return Object.assign(pool, profileFor(set, projectId, kind)?.values)
}

/** The kind's values that are set, in the adapter's order: a profile's credentials as `setup` takes them. */
export function valuesOf(adapter: Pick<TrackerAdapter, 'variables'>, env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(adapter.variables.flatMap((name) => (env[name] ? [[name, env[name]]] : [])))
}

/**
 * The profiles the trackers' variables of the environment make at the first start: one per tracker whose variables
 * `setup` takes, default for its kind. A tracker whose variables are set only in part is left out with a line.
 */
export function profilesOfEnv(env: Record<string, string | undefined>, adapters: Adapters, log: (line: string) => void): Omit<TrackerProfile, 'id'>[] {
  return Object.entries(adapters).flatMap(([kind, adapter]) => {
    const values = valuesOf(adapter, env)
    if (Object.keys(values).length === 0) return []
    try {
      if (adapter.setup(values, {}) === undefined) return []
    } catch (error) {
      log(`profiles: the ${adapter.title} variables of .env make no profile: ${(error as Error).message}`)
      return []
    }
    return [{ kind, name: adapter.profileName(values, null), values, isDefault: true, login: null, expiresAt: null }]
  })
}

/** The profile of the same tracker, host and login as the values, other than `id`: a second profile of one account. */
export function sameAccount(set: ProfileSet, adapter: TrackerAdapter, kind: string, values: Record<string, string>, login: string, id: string | null): TrackerProfile | undefined {
  const host = (each: Record<string, string>) => JSON.stringify(adapter.hostVariables.map((name) => (each[name] ?? '').trim().replace(/\/+$/, '').toLowerCase()))
  return set.profiles.find((profile) => profile.id !== id && profile.kind === kind && profile.login === login && host(profile.values) === host(values))
}
