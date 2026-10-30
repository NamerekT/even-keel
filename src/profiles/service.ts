import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { englishOf, fail, noticeOf, NoticeError } from '../notice/notice.js'
import { withSessionEnv } from '../secrets/service.js'
import { isSecret } from '../secrets/catalog.js'
import type { CheckResult, CiRemote, ProfileCheck, ProfilesView } from '../state.js'
import type { Db, Writes } from '../storage/database.js'
import { CredentialsRefused, type ProfileAccount, type TrackerProject } from '../tracker/source.js'
import { defaultProfile, profileFor, sameAccount, valuesOf, type ProfileKind, type ProfileKinds, type ProfileRules, type ProfileSet, type TrackerProfile } from './model.js'
import { cleanRules } from './rules.js'
import { saveProfiles } from './store.js'
import { McpOAuth, MCP_OAUTH, type OAuthRecord } from './oauth.js'
import { checkMcpOAuth } from './mcp.js'
import type { GatewayOAuth } from '../packages/gateway.js'

/** How often every profile is checked again: a revoked token turns its profile red and pauses its chains. */
export const RECHECK_MS = 15 * 60_000
const FIRST_CHECK_MS = 15_000
/** A profile is checked again on a tracker's failure at most this often. */
const SOON_MS = 60_000

export interface ProfilesDeps {
  db: Db
  writes: Writes
  /** The trackers' kinds and the CIs' (`profileKinds`). */
  kinds: ProfileKinds
  /** As stored at the start. */
  set: ProfileSet
  /** The projects by id, each with its key and its tracker; a project's extra feed (BTN-66) is marked `feed`. */
  projects: () => Readonly<Record<string, { key: string; kind: string; feed?: boolean }>>
  /** The projects and feeds whose profile stays: the chain has started a task of theirs. */
  locked?: () => readonly string[]
  /** The global `settings.json`: a kind's default profile is the one sessions started by hand get. */
  settingsFile: () => string
  /** A variable left the sessions' settings: the daemon of the global folder still hands it out until it restarts. */
  expired: () => void
  /** The remotes whose CI takes the profile's token and shows (`CiWatches`). */
  ci?: (profileId: string) => CiRemote[]
  /** The remotes whose CI takes the profile's token but does not show: the token does not reach it. */
  hiddenCi?: (profileId: string) => CiRemote[]
  /** Throws the clash the profile's new rules would make with a project on it (`checkProfileRules`). */
  checkRules?: (set: ProfileSet, id: string, rules: ProfileRules) => void
  /** The remotes whose forge refused to open a pull request with the profile's token (`PullRefusals`). */
  deniedPulls?: (profileId: string) => CiRemote[]
  timeoutMs: number
  now?: () => Date
  log: (line: string) => void
  /** The profiles or the projects' choices changed: the trackers, the CI and the gateway take them. */
  onChange: (set: ProfileSet) => void
  /** Only a check's outcome changed. */
  onCheck?: () => void
}

/** Values from the page: an empty secret of a stored profile keeps the stored one, `null` clears a field. */
export type ProfileValues = Record<string, string | null>

export interface ProfileDraft {
  /** A stored profile being edited; none — a new one. */
  id?: string
  kind: string
  values: ProfileValues
  /** A completed browser grant, or null to return to the profile's API token. */
  oauth?: string | null
}

/**
 * The trackers' profiles (BTN-200) and the CIs' (BTN-201) while the service runs: the page's edits, each written behind to
 * the state database whole, the checks against the trackers and the CIs, and the default tracker profiles' values in the
 * `env` of the global `settings.json`.
 */
export class Profiles {
  readonly oauth: McpOAuth
  private set: ProfileSet
  private readonly checks = new Map<string, ProfileCheck>()
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly deps: ProfilesDeps) {
    this.set = deps.set
    this.oauth = new McpOAuth({
      log: deps.log,
      get: (id) => this.profile(id)?.mcpOAuth,
      put: async (id, expected, next) => {
        const current = this.profile(id)
        if (current?.mcpOAuth !== expected) return false
        this.replace({ ...this.set, profiles: this.set.profiles.map((each) => each.id === id ? { ...each, mcpOAuth: next } : each) }, null)
        await this.deps.writes.settled()
        return true
      },
      verify: async (_kind, values, token) => {
        await checkMcpOAuth(values as Record<string, string>, token, deps.timeoutMs)
      },
    })
  }

  async connectMcp(draft: ProfileDraft, redirect: string): Promise<{ flow: string; url: string }> {
    const { values } = this.valuesOf(draft)
    return this.oauth.start({ ...draft, values }, redirect)
  }

  gateway(id: string | undefined, kind: string, url: unknown): GatewayOAuth | undefined {
    const profile = id === undefined ? undefined : this.profile(id)
    const record = profile?.mcpOAuth
    if (!profile || profile.kind !== kind || !record || typeof url !== 'string') return undefined
    const expected = MCP_OAUTH[kind]?.url
    if (!expected || record.server !== expected) return undefined
    try {
      const target = new URL(url)
      const source = new URL(expected)
      if (target.origin !== source.origin || target.pathname !== source.pathname || target.username || target.password) return undefined
    } catch { return undefined }
    return { token: (rejected) => this.oauth.token(profile.id, rejected), refused: (token) => this.oauth.refused(profile.id, token) }
  }

  private oauthOf(draft: ProfileDraft, values: Record<string, string>): OAuthRecord | undefined {
    if (draft.oauth === null) return undefined
    if (typeof draft.oauth === 'string') return this.oauth.completed(draft.oauth, { ...draft, values })
    const stored = draft.id === undefined ? undefined : this.profile(draft.id)
    if (stored?.mcpOAuth && JSON.stringify(values) !== JSON.stringify(stored.values)) {
      // A new REST identity must not keep the previous MCP identity silently.
      const identity = this.deps.kinds[draft.kind]?.hostVariables ?? []
      if (identity.some((key) => values[key] !== stored.values[key])) throw fail('profiles.oauthExpired', {})
    }
    return stored?.mcpOAuth
  }

  current(): ProfileSet {
    return this.set
  }

  view(): ProfilesView {
    return {
      profiles: this.set.profiles.map((profile) => ({
        id: profile.id,
        kind: profile.kind,
        name: profile.name,
        isDefault: profile.isDefault,
        fields: (this.deps.kinds[profile.kind]?.variables ?? Object.keys(profile.values)).map((name) => {
          const value = profile.values[name] || null
          return { name, secret: isSecret(name), set: value !== null, value: isSecret(name) ? null : value }
        }),
        login: profile.login,
        expiresAt: profile.expiresAt,
        check: this.checks.get(profile.id) ?? { state: 'unchecked', error: null, at: null },
        projects: this.projectsOn(profile).map(([, project]) => project.key),
        ci: this.deps.ci?.(profile.id) ?? [],
        hiddenCi: this.deps.hiddenCi?.(profile.id) ?? [],
        deniedPulls: this.deps.deniedPulls?.(profile.id) ?? [],
        rules: profile.rules ?? {},
        projectIds: this.projectsOn(profile).map(([id]) => id),
        ...(profile.mcpOAuth === undefined ? {} : { mcpOAuth: { state: profile.mcpOAuth.reconnect ? 'reconnect' as const : 'connected' as const } }),
      })),
      kinds: Object.entries(this.deps.kinds).map(([kind, each]) => ({
        kind,
        title: each.title,
        tracker: each.projects !== undefined,
        fields: each.variables.map((name) => ({ name, secret: isSecret(name) })),
        hostVariables: [...each.hostVariables],
        alternatives: (each.alternatives ?? []).map((names) => [...names]),
        help: each.help,
        ...(MCP_OAUTH[kind] !== undefined ? { mcpOAuth: true } : each.mcpKeys !== undefined ? { mcpShared: true } : {}),
      })),
    }
  }

  async check(draft: ProfileDraft): Promise<CheckResult> {
    const { adapter, values } = this.valuesOf(draft)
    const { account } = await this.checkedAccount(draft, adapter, values)
    const duplicate = sameAccount(this.set, adapter, draft.kind, values, account.login, draft.id ?? null)
    return { login: account.login, name: account.name, expiresAt: account.expiresAt, duplicate: duplicate?.name ?? null }
  }

  /** Stores the draft once the tracker takes it; the first profile of a kind is its default. Returns the profile's id. */
  async save(draft: ProfileDraft & { name: string }): Promise<string> {
    const { adapter, values } = this.valuesOf(draft)
    const stored = draft.id === undefined ? undefined : this.profile(draft.id)
    if (stored !== undefined) {
      const users = this.projectsOn(stored)
      const moved = adapter.hostVariables.some((name) => (stored.values[name] ?? '') !== (values[name] ?? ''))
      if (users.length > 0 && moved) throw fail('profiles.hostLocked', { profile: stored.name, projects: keysOf(users) })
    }
    const { account, oauth } = await this.checkedAccount(draft, adapter, values)
    const profile: TrackerProfile = {
      ...(stored?.rules === undefined ? {} : { rules: stored.rules }),
      id: stored?.id ?? randomUUID(),
      kind: draft.kind,
      name: draft.name.trim() || account.name,
      values,
      isDefault: stored?.isDefault ?? defaultProfile(this.set, draft.kind) === undefined,
      login: account.login,
      expiresAt: account.expiresAt,
      ...(oauth === undefined ? {} : { mcpOAuth: oauth }),
    }
    const profiles = stored === undefined ? [...this.set.profiles, profile] : this.set.profiles.map((each) => (each.id === profile.id ? profile : each))
    this.checks.set(profile.id, { state: 'ok', error: null, at: this.now() })
    this.replace({ ...this.set, profiles }, profile.isDefault ? profile.kind : null)
    if (typeof draft.oauth === 'string') this.oauth.forget(draft.oauth)
    return profile.id
  }

  remove(id: string): void {
    const profile = this.profile(id)
    if (profile === undefined) throw fail('profiles.unknown', {})
    const users = this.projectsOn(profile)
    if (users.length > 0) throw fail('profiles.inUse', { profile: profile.name, projects: keysOf(users) })
    let profiles = this.set.profiles.filter((each) => each.id !== id)
    const next = profile.isDefault ? profiles.find((each) => each.kind === profile.kind) : undefined
    if (next !== undefined) profiles = profiles.map((each) => (each === next ? { ...each, isDefault: true } : each))
    const links = Object.fromEntries(Object.entries(this.set.links).filter(([, profileId]) => profileId !== id))
    const feeds = Object.fromEntries(Object.entries(this.set.feeds ?? {}).filter(([, profileId]) => profileId !== id))
    this.checks.delete(id)
    this.replace({ profiles, links, feeds }, profile.isDefault ? profile.kind : null)
  }

  /** The profile's chain rules (BTN-66), once no project on it would put a name on both sides: only the keys set. */
  setRules(id: string, rules: ProfileRules): void {
    const profile = this.profile(id)
    if (profile === undefined) throw fail('profiles.unknown', {})
    const clean = cleanRules(rules)
    this.deps.checkRules?.(this.set, id, clean)
    const { rules: _, ...rest } = profile
    const updated: TrackerProfile = Object.keys(clean).length === 0 ? rest : { ...rest, rules: clean }
    this.replace({ ...this.set, profiles: this.set.profiles.map((each) => (each.id === id ? updated : each)) }, null)
  }

  /** The projects and feeds the chain has started on the old default stay on it, linked to it by name (BTN-435). */
  setDefault(id: string): void {
    const profile = this.profile(id)
    if (profile === undefined) throw fail('profiles.unknown', {})
    if (profile.isDefault) return
    const old = defaultProfile(this.set, profile.kind)
    const locked = new Set(this.deps.locked?.() ?? [])
    const kept = old === undefined ? [] : this.projectsOn(old).filter(([projectId]) => locked.has(projectId))
    const links = { ...this.set.links }
    const feeds = { ...this.set.feeds }
    for (const [projectId, project] of kept) (project.feed ? feeds : links)[projectId] = old!.id
    const profiles = this.set.profiles.map((each) => (each.kind === profile.kind ? { ...each, isDefault: each.id === id } : each))
    if (kept.length > 0) this.deps.log(`profiles: ${keysOf(kept)} stay on ${old!.name}: the chain has started their tasks`)
    this.replace({ profiles, links, feeds }, profile.kind)
  }

  /** The project, or with `feed` a project's feed (BTN-66), runs on the profile; `null` — on its tracker's default. */
  link(projectId: string, profileId: string | null, feed = false): void {
    const before = (feed ? this.set.feeds : this.set.links) ?? {}
    const links = { ...before }
    if (profileId === null) delete links[projectId]
    else {
      const profile = this.profile(profileId)
      const project = this.deps.projects()[projectId]
      if (profile === undefined) throw fail('profiles.unknown', {})
      if (project !== undefined && project.kind !== profile.kind) throw fail('profiles.otherTracker', { profile: profile.name, project: project.key })
      links[projectId] = profileId
    }
    if (links[projectId] === before[projectId]) return
    this.replace(feed ? { ...this.set, feeds: links } : { ...this.set, links }, null)
  }

  /** The values a new project of `kind` would run on: the profile chosen while it is of that tracker, else the kind's default. */
  valuesFor(profileId: string | null, kind: string): Record<string, string> {
    const chosen = profileId === null ? undefined : this.profile(profileId)
    return (chosen?.kind === kind ? chosen : defaultProfile(this.set, kind))?.values ?? {}
  }

  /** The tracker's projects the profile sees whose key or name has `query` in it. */
  async projects(id: string, query: string): Promise<TrackerProject[]> {
    const profile = this.profile(id)
    const kind = profile === undefined ? undefined : this.deps.kinds[profile.kind]
    if (profile === undefined || kind === undefined) throw fail('profiles.unknown', {})
    if (kind.projects === undefined) throw fail('profiles.unknownKind', { kind: profile.kind })
    return kind.projects(profile.values, query, this.deps.timeoutMs)
  }

  /** The profile the project runs on, if its tracker refused its credentials at the last check: its chain waits. */
  refused(projectId: string): TrackerProfile | undefined {
    const project = this.deps.projects()[projectId]
    const profile = project === undefined ? undefined : profileFor(this.set, projectId, project.kind)
    return profile !== undefined && this.checks.get(profile.id)?.state === 'refused' ? profile : undefined
  }

  start(): void {
    const run = () => void this.recheck()
    this.timer = setTimeout(() => {
      run()
      this.timer = setInterval(run, RECHECK_MS)
      this.timer.unref()
    }, FIRST_CHECK_MS)
    this.timer.unref()
  }

  stop(): void {
    clearTimeout(this.timer)
    clearInterval(this.timer)
  }

  /** Checks every profile, or the one, against its tracker. */
  async recheck(id?: string): Promise<void> {
    const profiles = this.set.profiles.filter((profile) => id === undefined || profile.id === id)
    await Promise.all(profiles.map((profile) => this.recheckOne(profile)))
  }

  /** A tracker link of the profile went down: checks it again unless it was checked within a minute. */
  recheckSoon(id: string): void {
    const at = this.checks.get(id)?.at
    if (at !== null && at !== undefined && Date.parse(this.now()) - Date.parse(at) < SOON_MS) return
    void this.recheck(id)
  }

  private async recheckOne(profile: TrackerProfile): Promise<void> {
    const adapter = this.deps.kinds[profile.kind]
    if (adapter === undefined) return
    const before = this.checks.get(profile.id)
    this.checks.set(profile.id, { state: 'checking', error: before?.error ?? null, at: before?.at ?? null })
    let account: ProfileAccount | undefined
    let check: ProfileCheck
    try {
      account = await this.account(adapter, restValues(profile.values, profile.mcpOAuth))
      check = { state: 'ok', error: null, at: this.now() }
    } catch (error) {
      const failure = noticeOf(error)
      check = { state: failure.code === 'profiles.refused' ? 'refused' : 'unreachable', error: failure, at: this.now() }
      if (before?.state !== check.state) this.deps.log(`profiles: ${profile.name}: ${englishOf(failure)}`)
    }
    this.checks.set(profile.id, check)
    const current = this.profile(profile.id)
    if (account !== undefined && current !== undefined && (current.login !== account.login || current.expiresAt !== account.expiresAt)) {
      const updated = { ...current, login: account.login, expiresAt: account.expiresAt }
      this.replace({ ...this.set, profiles: this.set.profiles.map((each) => (each.id === updated.id ? updated : each)) }, null)
    } else this.deps.onCheck?.()
  }

  private valuesOf(draft: ProfileDraft): { adapter: ProfileKind; values: Record<string, string> } {
    const adapter = this.deps.kinds[draft.kind]
    if (adapter === undefined) throw fail('profiles.unknownKind', { kind: draft.kind })
    const stored = draft.id === undefined ? undefined : this.profile(draft.id)
    if (draft.id !== undefined && stored === undefined) throw fail('profiles.unknown', {})
    if (stored !== undefined && stored.kind !== draft.kind) throw fail('profiles.unknownKind', { kind: draft.kind })
    const merged: Record<string, string | undefined> = { ...stored?.values }
    for (const [name, value] of Object.entries(draft.values)) {
      if (value === null) delete merged[name]
      else if (value.trim() !== '') merged[name] = value.trim()
      else if (!(stored !== undefined && isSecret(name))) delete merged[name]
    }
    const values = valuesOf(adapter, merged)
    let complete: boolean
    try {
      complete = adapter.complete(values)
    } catch (error) {
      throw fail('profiles.incomplete', { tracker: adapter.title }, { detail: (error as Error).message })
    }
    if (!complete) throw fail('profiles.incomplete', { tracker: adapter.title })
    return { adapter, values }
  }

  private async account(adapter: ProfileKind, values: Record<string, string>): Promise<ProfileAccount> {
    try {
      return await adapter.account(values, this.deps.timeoutMs)
    } catch (error) {
      if (error instanceof NoticeError) throw error
      const detail = error instanceof Error ? error.message : String(error)
      if (error instanceof CredentialsRefused) throw fail('profiles.refused', { tracker: adapter.title }, { detail })
      throw fail('profiles.unreachable', { tracker: adapter.title }, { detail })
    }
  }

  private async checkedAccount(draft: ProfileDraft, adapter: ProfileKind, values: Record<string, string>): Promise<{ account: ProfileAccount; oauth: OAuthRecord | undefined }> {
    let oauth = this.oauthOf(draft, values)
    const account = await this.account(adapter, restValues(values, oauth))
    if (oauth) oauth = typeof draft.oauth === 'string'
      ? await this.oauth.check(draft.oauth, draft.kind, values, { ...draft, values })
      : await this.oauth.check(draft.id!, draft.kind, values)
    return { account, oauth }
  }

  /** Takes the new set, writes it behind and, for `kind`, puts its default profile's values into the sessions' settings. */
  private replace(set: ProfileSet, kind: string | null): void {
    this.set = set
    this.deps.writes.add('profiles', saveProfiles(this.deps.db, set))
    if (kind !== null) this.writeSessionEnv(kind)
    this.deps.onChange(set)
  }

  /** A CI's kind is left out: its token is the service's alone (`sessionBase` keeps it from the sessions too). */
  private writeSessionEnv(kind: string): void {
    const adapter = this.deps.kinds[kind]
    if (adapter?.projects === undefined) return
    const file = this.deps.settingsFile()
    const values = defaultProfile(this.set, kind)?.values ?? {}
    try {
      const before = readText(file)
      let after = before
      for (const name of adapter.variables) after = withSessionEnv(after, name, values[name] ?? null)
      if (JSON.stringify(JSON.parse(after)) === JSON.stringify(before.trim() === '' ? {} : JSON.parse(before))) return
      writeFileSync(file, after)
      const env = (text: string) => ((text.trim() === '' ? {} : JSON.parse(text)) as { env?: Record<string, unknown> }).env ?? {}
      if (adapter.variables.some((name) => Object.hasOwn(env(before), name) && !Object.hasOwn(env(after), name))) this.deps.expired()
    } catch (error) {
      this.deps.log(`profiles: the sessions' settings.json keeps the old ${adapter.title} values: ${englishOf(noticeOf(error))}`)
    }
  }

  private profile(id: string): TrackerProfile | undefined {
    return this.set.profiles.find((profile) => profile.id === id)
  }

  /** The projects that run on the profile, by id. */
  private projectsOn(profile: TrackerProfile): [string, { key: string; kind: string; feed?: boolean }][] {
    return Object.entries(this.deps.projects()).filter(([id, project]) => profileFor(this.set, id, project.kind)?.id === profile.id)
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

const keysOf = (projects: [string, { key: string }][]): string => projects.map(([, project]) => project.key).join(', ')

function restValues(values: Record<string, string>, oauth: OAuthRecord | undefined): Record<string, string> {
  if (!oauth) return values
  const { JIRA_MCP_TOKEN: _, ...rest } = values
  return rest
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}
