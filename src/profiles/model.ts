import type { ChainRules } from '../chain/rules.js'
import type { TrackerAdapter } from '../tracker/source.js'

/**
 * The chain rules a tracker profile may set (BTN-66): its statuses and labels, which differ from tracker to tracker. The
 * milestone rules split one tracker project between Even Keel projects and stay with them.
 */
export const PROFILE_RULE_KEYS = ['active', 'terminal', 'requiredLabels', 'excludedLabels'] as const
export type ProfileRuleKey = (typeof PROFILE_RULE_KEYS)[number]
/** Only the keys the profile sets. */
export type ProfileRules = Partial<Pick<ChainRules, ProfileRuleKey>>

/**
 * A tracker profile (BTN-200): one set of credentials of one tracker. A project runs on one profile of its tracker; two
 * projects of the same tracker may run on two profiles (a personal GitHub token and an organization's).
 */
export interface TrackerProfile {
  /** A GUID. */
  id: string
  /** The adapter's name: `huly`, `github`, `linear`, `gitlab`. */
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
  /** The chain rules of its projects, between the shared ones and a project's own; none — it sets none. */
  rules?: ProfileRules
}

export interface ProfileSet {
  /** In the order they were made. */
  profiles: TrackerProfile[]
  /** The profile each project chose, by project id; a project without one runs on its tracker's default profile. */
  links: Record<string, string>
  /** The same for a project's extra task feed, by feed id (BTN-66); none — no feed chose one. */
  feeds?: Record<string, string>
}

export type Adapters = Readonly<Record<string, TrackerAdapter>>

/** What the profiles need of a kind: a tracker adapter's, or a CI's that is no tracker (Forgejo, BTN-201). */
export interface ProfileKind extends Pick<TrackerAdapter, 'title' | 'variables' | 'hostVariables' | 'alternatives' | 'help' | 'profileName' | 'account'> {
  /** Whether the values make a profile: `false` — none of them is set; throws when they are set only in part. */
  complete(values: Record<string, string | undefined>): boolean
  /**
   * A tracker's: the projects its profiles see. None — a CI's kind: no project runs on its profiles, a remote's CI takes
   * one by its host, and the sessions never get its values.
   */
  projects?: TrackerAdapter['projects']
}

export type ProfileKinds = Readonly<Record<string, ProfileKind>>

/** The trackers' kinds in the adapters' order, then the CIs'. */
export function profileKinds(trackers: Adapters, cis: ProfileKinds = {}): ProfileKinds {
  const own = Object.entries(trackers).map(([kind, adapter]): [string, ProfileKind] => [
    kind,
    {
      title: adapter.title,
      variables: adapter.variables,
      hostVariables: adapter.hostVariables,
      ...(adapter.alternatives === undefined ? {} : { alternatives: adapter.alternatives }),
      help: adapter.help,
      profileName: (values, account) => adapter.profileName(values, account),
      account: (values, timeoutMs) => adapter.account(values, timeoutMs),
      projects: (values, query, timeoutMs) => adapter.projects(values, query, timeoutMs),
      complete: (values) => adapter.setup(values, {}) !== undefined,
    },
  ])
  return { ...Object.fromEntries(own), ...cis }
}

/**
 * The profile a project, or a project's extra feed, runs on: the one it chose while that is of its tracker, else the
 * tracker's default.
 */
export function profileFor(set: ProfileSet, projectId: string | undefined, kind: string): TrackerProfile | undefined {
  const chosen = projectId === undefined ? undefined : (set.links[projectId] ?? set.feeds?.[projectId])
  const linked = chosen === undefined ? undefined : set.profiles.find((profile) => profile.id === chosen)
  return linked?.kind === kind ? linked : defaultProfile(set, kind)
}

export const defaultProfile = (set: ProfileSet, kind: string): TrackerProfile | undefined =>
  set.profiles.find((profile) => profile.kind === kind && profile.isDefault)

/**
 * The keys a project's MCP servers take (BTN-200): the environment without any kind's variables, then each kind's
 * default profile, then the profiles the project's feeds run on (BTN-66), then the profile the project runs on — its
 * tracker server signs in as that one, and a feed's tracker of another kind as the feed's.
 */
export function keyPool(
  set: ProfileSet,
  kinds: Readonly<Record<string, Pick<ProfileKind, 'variables'>>>,
  env: NodeJS.ProcessEnv,
  projectId: string | undefined,
  kind: string,
  feeds: readonly { id: string; tracker: string }[] = [],
): NodeJS.ProcessEnv {
  const pool: NodeJS.ProcessEnv = { ...env }
  for (const each of Object.values(kinds)) for (const name of each.variables) delete pool[name]
  for (const profile of set.profiles) if (profile.isDefault) Object.assign(pool, profile.values)
  for (const feed of feeds) Object.assign(pool, profileFor(set, feed.id, feed.tracker)?.values)
  return Object.assign(pool, profileFor(set, projectId, kind)?.values)
}

/** The profile a project's MCP server of `server`'s tracker signs in as under `keyPool`: the one written last. */
export function serverProfile(
  set: ProfileSet,
  projectId: string | undefined,
  kind: string,
  feeds: readonly { id: string; tracker: string }[],
  server: string,
): TrackerProfile | undefined {
  if (kind === server) return profileFor(set, projectId, kind)
  const feed = feeds.findLast((each) => each.tracker === server)
  return feed === undefined ? defaultProfile(set, server) : profileFor(set, feed.id, server)
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
export function sameAccount(set: ProfileSet, adapter: Pick<ProfileKind, 'hostVariables'>, kind: string, values: Record<string, string>, login: string, id: string | null): TrackerProfile | undefined {
  const host = (each: Record<string, string>) => JSON.stringify(adapter.hostVariables.map((name) => (each[name] ?? '').trim().replace(/\/+$/, '').toLowerCase()))
  return set.profiles.find((profile) => profile.id !== id && profile.kind === kind && profile.login === login && host(profile.values) === host(values))
}
