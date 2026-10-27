import { randomUUID } from 'node:crypto'
import { FORGEJO_PROFILE, FORGEJO_TOKEN, FORGEJO_URL, hostOf } from '../ci/forgejo-profile.js'
import { inTransaction, type Db, type Queryable } from '../storage/database.js'
import { setStateValue, stateValue } from '../storage/service-state.js'
import { profilesOfEnv, type Adapters, type ProfileRules, type ProfileSet, type TrackerProfile } from './model.js'

interface ProfileRow {
  id: string
  kind: string
  name: string
  credentials: string
  is_default: boolean
  login: string | null
  expires_at: string | null
  rules: string
  mcp_oauth: string
}

/** The profiles in their order and each project's and feed's profile, in one statement. */
export async function readProfiles(db: Queryable): Promise<ProfileSet> {
  const { rows } = await db.query<{ set: { profiles: ProfileRow[]; links: { id: string; profile_id: string }[]; feeds: { feed_id: string; profile_id: string }[] } }>(
    `select json_build_object(
       'profiles', (select coalesce(json_agg(p order by p.position), '[]'::json) from tracker_profiles p),
       'links', (select coalesce(json_agg(json_build_object('id', id, 'profile_id', profile_id)), '[]'::json) from projects where profile_id is not null),
       'feeds', (select coalesce(json_agg(f), '[]'::json) from feed_profiles f)
     ) as set`,
  )
  const { profiles, links, feeds } = rows[0]!.set
  return {
    profiles: profiles.map((row) => {
      const rules = JSON.parse(row.rules) as ProfileRules
      return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        values: JSON.parse(row.credentials) as Record<string, string>,
        isDefault: row.is_default,
        login: row.login,
        expiresAt: row.expires_at,
        ...(Object.keys(rules).length === 0 ? {} : { rules }),
        ...(row.mcp_oauth === 'null' ? {} : { mcpOAuth: JSON.parse(row.mcp_oauth) as TrackerProfile['mcpOAuth'] }),
      }
    }),
    links: Object.fromEntries(links.map((link) => [link.id, link.profile_id])),
    ...(feeds.length === 0 ? {} : { feeds: Object.fromEntries(feeds.map((feed) => [feed.feed_id, feed.profile_id])) }),
  }
}

/**
 * Puts the profiles and the projects' choices in place of the stored ones, whole, in one transaction: a profile it lacks
 * goes, a project it does not name runs on its tracker's default. A project the set names but the database does not
 * have yet is left for the next save. Starts its write at the call: see `Writes`.
 */
export function saveProfiles(db: Db, { profiles, links, feeds = {} }: ProfileSet, now: Date = new Date()): Promise<void> {
  const rows = profiles.map((profile, position) => ({
    id: profile.id,
    kind: profile.kind,
    name: profile.name,
    credentials: JSON.stringify(profile.values),
    is_default: profile.isDefault,
    login: profile.login,
    expires_at: profile.expiresAt,
    position,
    created_at: now.toISOString(),
    rules: JSON.stringify(profile.rules ?? {}),
    mcp_oauth: JSON.stringify(profile.mcpOAuth ?? null),
  }))
  return inTransaction(db, async (tx) => {
    await tx.query('update projects set profile_id = ($1::json ->> id) where profile_id is distinct from ($1::json ->> id)', [JSON.stringify(links)])
    await tx.query('delete from feed_profiles')
    await tx.query('insert into feed_profiles select key, value from json_each_text($1::json)', [JSON.stringify(feeds)])
    await tx.query('delete from tracker_profiles where id not in (select json_array_elements_text($1::json))', [JSON.stringify(rows.map((row) => row.id))])
    // The default of a kind is unique row by row: clear them all before the new ones are written.
    await tx.query('update tracker_profiles set is_default = false where is_default')
    await tx.query(
      `insert into tracker_profiles select * from json_populate_recordset(null::tracker_profiles, $1)
       on conflict (id) do update set kind = excluded.kind, name = excluded.name, credentials = excluded.credentials,
         is_default = excluded.is_default, login = excluded.login, expires_at = excluded.expires_at, position = excluded.position,
         rules = excluded.rules, mcp_oauth = excluded.mcp_oauth`,
      [JSON.stringify(rows)],
    )
  })
}

export interface ImportProfilesOptions {
  db: Db
  env: Record<string, string | undefined>
  adapters: Adapters
  /** The tracker of each project, by project id. */
  trackers: Record<string, string>
  log: (line: string) => void
}

/**
 * At the first start with profiles, the trackers' variables of the environment (`.env`) become each tracker's default
 * profile, and the projects of that tracker run on it; later starts read the profiles only. Returns the stored set.
 */
export async function importProfiles({ db, env, adapters, trackers, log }: ImportProfilesOptions): Promise<ProfileSet> {
  if ((await stateValue(db, 'profiles.imported')) !== undefined) return readProfiles(db)
  const profiles: TrackerProfile[] = profilesOfEnv(env, adapters, log).map((profile) => ({ id: randomUUID(), ...profile }))
  const links = Object.fromEntries(
    Object.entries(trackers).flatMap(([project, kind]) => {
      const profile = profiles.find((each) => each.kind === kind)
      return profile === undefined ? [] : [[project, profile.id]]
    }),
  )
  const set = { profiles, links }
  await inTransaction(db, async (tx) => {
    await saveProfiles(tx, set)
    await setStateValue(tx, 'profiles.imported', new Date().toISOString())
  })
  if (profiles.length > 0) {
    const names = profiles.map((profile) => `${profile.name} (${Object.values(links).filter((id) => id === profile.id).length} projects)`)
    log(`profiles: the trackers' variables of .env became the profiles ${names.join(', ')}; .env is not read for them any more`)
  }
  return set
}

export interface ImportForgejoOptions {
  db: Db
  env: Record<string, string | undefined>
  /** The web addresses of the projects' Forgejo remotes as they are now (`CiTarget.web`). */
  webs: () => Promise<string[]>
  log: (line: string) => void
}

/**
 * At the first start with Forgejo profiles (BTN-201), `FORGEJO_TOKEN` of the environment becomes a Forgejo profile per
 * host of the projects' Forgejo remotes, the first one the default; later starts do not read the variable. Returns the
 * stored set.
 */
export async function importForgejo({ db, env, webs, log }: ImportForgejoOptions): Promise<ProfileSet> {
  const stored = await readProfiles(db)
  if ((await stateValue(db, 'profiles.forgejo.imported')) !== undefined) return stored
  const token = env[FORGEJO_TOKEN]
  const byHost = new Map<string, string>()
  for (const web of token ? await webs() : []) {
    const host = hostOf(web)
    if (host !== null && !byHost.has(host)) byHost.set(host, web)
  }
  const hasDefault = stored.profiles.some((profile) => profile.kind === 'forgejo' && profile.isDefault)
  const made: TrackerProfile[] = [...byHost.values()].map((web, index) => {
    const values = { [FORGEJO_URL]: web, [FORGEJO_TOKEN]: token! }
    return { id: randomUUID(), kind: 'forgejo', name: FORGEJO_PROFILE.profileName(values, null), values, isDefault: !hasDefault && index === 0, login: null, expiresAt: null }
  })
  const set = { ...stored, profiles: [...stored.profiles, ...made] }
  await inTransaction(db, async (tx) => {
    if (made.length > 0) await saveProfiles(tx, set)
    await setStateValue(tx, 'profiles.forgejo.imported', new Date().toISOString())
  })
  if (made.length > 0) log(`profiles: FORGEJO_TOKEN of .env became the profiles ${made.map((profile) => profile.name).join(', ')}; .env is not read for it any more`)
  else if (token) log('profiles: FORGEJO_TOKEN of .env made no profile: no project has a Forgejo remote; add a Forgejo profile on the Trackers and CI tab')
  return set
}
