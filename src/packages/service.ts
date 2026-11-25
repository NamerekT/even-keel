import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionPlugin, SessionStart } from '../agent/contract.js'
import { fail, notice, noticeOf, type Notice } from '../notice/notice.js'
import type { ServerOverride } from '../link/view.js'
import { readsFileMemory } from '../memory/mcp.js'
import type { KeyView, PackagesHeld, PackagesView, PackageView, ProjectPackages } from '../state.js'
import { TASKS_SERVER } from '../taskmcp/server.js'
import { PassMemo } from '../pass-memo.js'
import { bringsServer, NEEDS_USER, Probes, projectPackages } from './check.js'
import { hubOwned, McpGateway, withoutAuthorization, type GatewayHub, type GatewayOAuth, type GatewayTarget, type LocalMcp } from './gateway.js'
import { applySettings, keysOf, substitute, upsertEnv, type KeyRules } from './keys.js'
import { ensureMarketplace, otherPlugins, pluginDir, routeOf, sessionPackages, sessionReach } from './launch.js'
import { catalogFor, followCatalog, type CatalogBrief } from './follow.js'
import { Installs } from './installs.js'
import { current, defaultsOf, installsFor, keepBuiltIn, OWN_SKILLS_PACKAGE, packageSettings, pluginKey, retireCheckpoint, retireOwnSkills, unpinned, type OwnPackages, type PackagesFile, type ServerEntry, type SessionReach } from './model.js'
import { repoImports, seedCatalog, SERVER_NAME } from './repo-reads.js'
import { pageSettings } from './settings.js'
import { availablePlugins, builtInPackage, FETCHED, knowsMarketplace, locatePlugin, ownMarketplace, ownPackage, pluginOffer, readJson, serversIn, TASKS_PLUGIN } from './plugins.js'
import { loadPackages, savePackages } from './store.js'
import { heldPackages } from './held.js'
import { hubRoutes, packageTarget } from './hub.js'
import { stdioOf, type StdioServer } from './stdio.js'
import { isNewer } from './version.js'

/** How long the marketplaces' plugin lists and versions are kept before they are read again. */
const AVAILABLE_MS = 60_000

type Offer = ReturnType<typeof pluginOffer>

export interface PackagesDeps {
  /** False for a machine elsewhere: it follows the hub's installs instead of Even Keel's own marketplace (`ownCurrent`). */
  hub?: boolean
  hubServers?: () => string[]
  /** `state/packages.json`. */
  file: string
  /** `state/packages`. */
  cache: string
  /** Even Keel's own `.env`: the pool of keys. */
  envFile: string
  /** The repository of each project, by id. */
  repos: Record<string, string>
  /** The global configuration folder: its marketplaces and installed plugins, its `settings.json`. */
  globalDir: string
  /** Even Keel's checkout: its `.claude-plugin/marketplace.json` offers its own plugins. */
  ownDir: string
  /** `state/skills`: where the retired package of the user's own skills was built (`retireOwnSkills`); removed at start. */
  skillsDir: string
  /** `.claude.json` files sessions read: their user scope servers seed the catalog. */
  claudeConfigs: () => string[]
  rules: KeyRules
  /** The MCP server of the project's tracker; `required` — `brief` is off, so its sessions cannot do without it; `also` — the tasks server when it serves the tracker. */
  tracker: (project: string) => { server: string; required: boolean; also?: string } | undefined
  /** The agent of the account the project's next session runs on. */
  agentOf: (project: string) => string
  /** `claude plugin marketplace update <marketplace>` in the global configuration. */
  updateMarketplace: (marketplace: string) => Promise<void>
  /** `claude plugin marketplace add <dir>` in the global configuration. */
  addMarketplace: (dir: string) => Promise<void>
  /** The environment of a server process before its own variables. */
  baseEnv: () => NodeJS.ProcessEnv
  /** The keys the project's servers take, its tracker profile's among them (`keyPool`); by project id. */
  poolOf: (project: string) => NodeJS.ProcessEnv
  oauth?: (project: string, server: string, url: unknown) => GatewayOAuth | undefined
  /** The tracker whose deletes the project's Protection refuses, when the server is that tracker's. */
  refuseDeletes?: (project: string, server: string) => string | undefined
  /** A machine elsewhere's own stdio command of a package's server in the project, from the hub's brief (BTN-994). */
  serverOverride?: (project: string, name: string, server: string) => ServerOverride | undefined
  /** Even Keel's own tasks server, answered by the gateway (BTN-768). */
  tasks?: LocalMcp
  /** Even Keel's own memory server, answered by the hub's gateway (BTN-1029). */
  memory?: LocalMcp
  port: number
  log: (line: string) => void
  /** The view or what a project is held on changed. */
  onChange: () => void
  /** The project has a chain running, not paused: its failing servers are asked again at least once a minute (BTN-1518). */
  waited?: (project: string) => boolean
}

/** Packages of the projects (BTN-174): the catalog, each project's set, the pins of running tasks, the keys and the gateway. */
export class Packages {
  private file: PackagesFile
  private readonly installs: Installs
  /** The outcome of each package's last update. */
  private readonly notes = new Map<string, Notice>()
  /** The machine's gateway: sessions and probes reach their servers here. */
  private readonly gateway: McpGateway
  private readonly probes: Probes
  private gatewayError: Notice | null = null
  private imports: Record<string, string[]> = {}
  private plugins: { at: number; list: PackagesView['available']; marketplace: PackagesView['marketplace'] } | undefined
  private offers: { at: number; byName: Map<string, Offer> } | undefined
  private readonly checks = new PassMemo()

  /** The package every project has (BTN-986); `undefined` when the checkout's marketplace lacks the plugin. */
  private readonly builtIn: string | undefined
  /** Checks Even Keel's own marketplace for newer plugins once a minute (`ownCurrent`). */
  private ownTimer: NodeJS.Timeout | undefined

  constructor(private readonly deps: PackagesDeps) {
    this.builtIn = builtInPackage(deps.ownDir)
    const loaded = loadPackages(deps.file)
    this.file = loaded ?? seedCatalog(deps, this.builtIn)
    const retired = this.builtIn === undefined ? undefined : retireCheckpoint(this.file, this.builtIn)
    if (retired !== undefined) deps.log(`packages: ${retired} replaced by ${this.builtIn}`)
    const repaired = loaded === undefined || this.builtIn === undefined ? [] : keepBuiltIn(this.file, this.builtIn)
    if (repaired.length > 0) deps.log(`packages: ${this.builtIn} is built in and restored: ${repaired.join(', ')}`)
    const ownSkills = retireOwnSkills(this.file)
    if (ownSkills) deps.log(`packages: ${OWN_SKILLS_PACKAGE} removed: the user's skills reach every agent from the config store`)
    if (loaded === undefined || retired !== undefined || repaired.length > 0 || ownSkills) savePackages(deps.file, this.file)
    rmSync(join(deps.cache, OWN_SKILLS_PACKAGE), { recursive: true, force: true })
    rmSync(deps.skillsDir, { recursive: true, force: true })
    this.installs = new Installs({
      deps,
      file: () => this.file,
      local: () => this.local,
      recordOf: (name) => this.recordOf(name),
      forgetOffer: (name) => this.offers?.byName.delete(name),
      prune: () => this.prune(),
      save: () => this.save(),
    })
    this.gateway = new McpGateway({ resolve: (route) => this.target(route), baseEnv: deps.baseEnv, log: deps.log, tasks: deps.tasks, memory: deps.memory })
    this.probes = new Probes({
      urlOf: (project, name, install, server) => (this.gateway.listening ? `${this.gateway.origin}${routeOf(project, name, install, server)}` : undefined),
      now: () => Date.now(),
      onChange: deps.onChange,
      ...(deps.waited === undefined ? {} : { waited: deps.waited }),
    })
  }

  /** Listens, installs every package with no install yet and again every install whose folder is gone, and reads the repositories' `.mcp.json` to offer. */
  async start(): Promise<void> {
    try {
      await this.gateway.listen(this.deps.port)
      this.deps.log(`mcp gateway: listening on ${this.gateway.origin}`)
      // Servers held as probing until now get asked on the next state build.
      this.deps.onChange()
    } catch (error) {
      this.gatewayError = noticeOf(error)
      this.deps.log(`mcp gateway: ${(error as Error).message}`)
    }
    for (const [name, record] of Object.entries(this.file.packages)) if (record.removed !== true && record.installs.length === 0) void this.install(name).catch(() => {})
    this.ownCurrent()
    // After the newer versions: one installed anew needs no copy of the old.
    this.installs.restoreLost()
    this.ownTimer ??= setInterval(() => this.ownCurrent(), AVAILABLE_MS)
    this.ownTimer.unref()
    await this.readImports()
  }

  async close(): Promise<void> {
    clearInterval(this.ownTimer)
    this.ownTimer = undefined
    await this.gateway.close()
  }

  /**
   * A newer plugin in Even Keel's own marketplace becomes its package's current install by itself — the built-in one
   * (BTN-1332) and every other installed and not removed (BTN-1400): they are a part of Even Keel, so a new version of
   * Even Keel brings them without Update. One turned off in a project is updated all the same. Pinned tasks keep
   * theirs; a machine elsewhere follows the hub's installs instead.
   */
  private ownCurrent(): void {
    if (this.deps.hub === false) return
    const own = ownMarketplace(this.deps.ownDir)
    if (own === undefined) return
    for (const [name, record] of Object.entries(this.file.packages)) {
      const install = current(record)
      if (record.plugin?.marketplace !== own || record.removed === true || install === undefined || this.installs.installing.has(name)) continue
      const offer = pluginOffer(this.deps.globalDir, record.plugin.name, own, this.local)
      if (offer === undefined || !isNewer(offer.version, install.version)) continue
      this.deps.log(`packages: ${name} ${offer.version} in Even Keel's marketplace replaces ${install.version ?? install.id}`)
      void this.installs.installNew(name).catch(() => {})
    }
  }

  /** The machine's gateway takes the servers holding keys and the tasks server from the hub from now on (BTN-990). */
  throughHub(hub: GatewayHub): void {
    this.gateway.throughHub(hub)
  }

  /** The hub publishes only route names to machines, never the resolved targets containing its keys. */
  hubServers(): string[] {
    return hubRoutes(this.file, this.deps, Object.keys(this.deps.repos))
  }

  /** The hub's catalog for a machine elsewhere serving `projects` (BTN-1299); `hubRoutes` — the hub's `hubServers()`. */
  catalogFor(projects: string[], hubRoutes: readonly string[]): CatalogBrief {
    return catalogFor(this.file, projects, hubRoutes)
  }

  /**
   * A machine elsewhere follows the hub's catalog from its brief (BTN-1299): the hub's packages and its projects' sets
   * replace its own, and the hub's installs it lacks are installed here under their ids.
   */
  follow(catalog: CatalogBrief): void {
    const before = JSON.stringify(this.file)
    const missing = followCatalog(this.file, catalog, this.builtIn)
    this.installs.follow(new Map(Object.entries(catalog.packages).flatMap(([name, record]) => {
      const install = current(record)
      return install === undefined ? [] : [[name, install] as const]
    })))
    this.prune()
    if (JSON.stringify(this.file) !== before) this.save()
    for (const { name } of missing) this.installs.materialize(name)
  }

  /** The projects of the config changed: the repositories are read for servers anew. */
  async projectsChanged(): Promise<void> {
    await this.readImports()
  }

  view(): PackagesView {
    const packages: PackageView[] = Object.entries(this.file.packages).map(([name, record]) => {
      const install = current(record)
      const offer = record.plugin === undefined || record.removed === true ? undefined : this.offerOf(name, record.plugin)
      return {
        name,
        kind: record.kind,
        // A current install whose files are gone here is installed anew by the row's Install (BTN-1542).
        installed: install !== undefined && !this.installs.lostHere(name, install),
        version: install?.version ?? null,
        latest: install !== undefined && offer !== undefined && isNewer(offer.version, install.version) ? offer.version : null,
        fetched: offer?.fetched ?? null,
        installing: this.installs.installing.has(name),
        error: this.installs.errors.get(name) ?? null,
        note: this.notes.get(name) ?? null,
        default: record.default,
        settings: pageSettings(packageSettings(record)),
        servers: Object.keys(install?.servers ?? {}),
        unpinned: Object.entries(install?.servers ?? {}).filter(([, server]) => server.npm === null && typeof server.entry.command === 'string').map(([server]) => server),
        scripts: Object.values(install?.servers ?? {}).some((server) => server.npm !== null) ? record.scripts === true : null,
        extras: install?.extras ?? false,
        removed: record.removed === true,
        builtIn: name === this.builtIn,
      }
    })
    const projects = Object.fromEntries(Object.keys(this.deps.repos).map((project) => [project, this.check(project)]))
    const { marketplace } = this.marketplaces()
    return { gateway: this.gatewayError, packages, projects, keys: this.keys(), available: this.available(), marketplace, imports: this.imports }
  }

  /** The marketplaces' plugins not in the catalog. */
  private available(): PackagesView['available'] {
    return this.marketplaces().list.filter((each) => {
      const known = this.file.packages[pluginKey(each.plugin, each.marketplace)]
      return known === undefined || known.removed === true
    })
  }

  /** Even Keel's checkout. */
  private get local(): string[] {
    return [this.deps.ownDir]
  }

  /** The marketplaces' plugins and whether Claude Code knows Even Keel's own; the files are read again at most once a minute. */
  private marketplaces(): NonNullable<Packages['plugins']> {
    if (this.plugins === undefined || Date.now() - this.plugins.at > AVAILABLE_MS) {
      const name = ownMarketplace(this.deps.ownDir)
      const marketplace = name === undefined ? null : { name, dir: this.deps.ownDir, known: knowsMarketplace(this.deps.globalDir, name) }
      this.plugins = { at: Date.now(), list: availablePlugins(this.deps.globalDir, this.local), marketplace }
    }
    return this.plugins
  }

  /** Even Keel's own marketplace into Claude Code, for the sessions started by hand; chain sessions do without it. */
  async addMarketplace(): Promise<void> {
    const name = ownMarketplace(this.deps.ownDir)
    if (name === undefined) throw fail('packages.noOwnMarketplace', { dir: this.deps.ownDir })
    try {
      await this.deps.addMarketplace(this.deps.ownDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw fail('packages.marketplaceCliMissing', {}, {}, { cause: error })
      throw fail('packages.marketplaceAdd', { marketplace: name }, { detail: (error as Error).message }, { cause: error })
    }
    this.deps.log(`packages: the marketplace ${name} added to Claude Code from ${this.deps.ownDir}`)
    this.plugins = undefined
    this.offers = undefined
    this.deps.onChange()
  }

  /** What the plugin's marketplace holds now; read again at most once a minute, or after an update fetched it. */
  private offerOf(name: string, plugin: { name: string; marketplace: string }): Offer {
    if (this.offers === undefined || Date.now() - this.offers.at > AVAILABLE_MS) this.offers = { at: Date.now(), byName: new Map() }
    if (!this.offers.byName.has(name)) this.offers.byName.set(name, pluginOffer(this.deps.globalDir, plugin.name, plugin.marketplace, this.local))
    return this.offers.byName.get(name)
  }

  /** Every pool variable a package reads: sessions do not get them in their environment. */
  keyNames(): string[] {
    return this.keys().map((key) => key.name)
  }

  /** Whether a package the project's sessions get brings the server. */
  bringsServer(project: string, server: string): boolean {
    return bringsServer(this.file, project, server)
  }

  /**
   * A new project whose tracker Even Keel's tasks server serves gets it on (BTN-1028): the catalog's package of the
   * `tasks` plugin, else another one that brings the server, else the plugin added from the checkout's marketplace and
   * installed in the background. An ordinary package: the user turns it off or removes it like any other.
   */
  turnOnTasks(project: string): void {
    const tracker = this.deps.tracker(project)
    if (tracker?.server !== TASKS_SERVER && tracker?.also !== TASKS_SERVER) return
    if (this.bringsServer(project, TASKS_SERVER)) return
    const plugin = ownPackage(this.deps.ownDir, TASKS_PLUGIN)
    const live = Object.entries(this.file.packages).filter(([, record]) => record.removed !== true)
    const known = live.find(([name]) => name === plugin)?.[0] ?? live.find(([, record]) => current(record)?.servers[TASKS_SERVER] !== undefined)?.[0]
    try {
      if (known !== undefined) this.choose(project, known, 'on')
      else if (plugin !== undefined) this.addPlugin(TASKS_PLUGIN, ownMarketplace(this.deps.ownDir)!, project)
      else this.deps.log(`packages: no ${TASKS_PLUGIN} plugin in ${this.deps.ownDir}; the new project ${project} gets no ${TASKS_SERVER} server`)
    } catch (error) {
      // The project is written already: it stays, and the page's tracker buttons offer the package as for any project.
      this.deps.log(`packages: ${TASKS_PLUGIN} not turned on for the new project ${project}: ${(error as Error).message}`)
    }
  }

  /** The tracker's MCP server the project's sessions need and no package brings (`noTrackerMcp`); `undefined` — none missing. */
  trackerMissing(project: string): string | undefined {
    const missing = this.check(project).problems.find((problem) => problem.kind === 'noTrackerMcp')
    return missing?.kind === 'noTrackerMcp' ? missing.server : undefined
  }

  /** The enabled packages of the project that only the user can make ready: not installed, failed to install or lacking a key. */
  unready(project: string): string[] {
    const cells = Object.entries(this.check(project).cells)
    return cells.filter(([, cell]) => cell.enabled && cell.problems.some((problem) => NEEDS_USER.has(problem.kind))).map(([name]) => name)
  }

  /** The enabled packages of the project being installed right now: a new project's window waits for them (BTN-1048). */
  installingOf(project: string): string[] {
    return Object.entries(this.check(project).cells).filter(([name, cell]) => cell.enabled && this.installs.installing.has(name)).map(([name]) => name)
  }

  /**
   * The stdio servers of the packages turned on in the project that this machine's gateway starts: not the hub's own
   * (BTN-990), each with the machine's own command where the hub names one (BTN-994).
   */
  localStdio(project: string): StdioServer[] {
    const hub = new Set(this.deps.hubServers?.() ?? [])
    return Object.entries(this.check(project).cells).flatMap(([name, cell]) => {
      const install = cell.enabled ? current(this.file.packages[name]!) : undefined
      if (install === undefined) return []
      return Object.keys(install.servers).flatMap((server) => {
        const target = hub.has(routeOf(project, name, install.id, server)) ? null : this.target({ project, name, install: install.id, server })
        const stdio = target === null || hubOwned(target) ? undefined : stdioOf(name, server, target.entry)
        return stdio === undefined ? [] : [stdio]
      })
    })
  }

  /** The chain waits while the project's set has a problem that holds it. */
  blocked(project: string): boolean {
    return this.gatewayError !== null || this.check(project).blocked
  }

  /** What holds the project's sessions while `blocked`, for a hub that does not see this machine's set (BTN-1524). */
  held(project: string): PackagesHeld | undefined {
    if (!this.blocked(project)) return undefined
    return { ...(this.gatewayError !== null && { gateway: true as const }), packages: heldPackages(this.check(project)) }
  }

  /**
   * What a session of the task gets on the agent. The pin follows the set it starts with (BTN-706): a package the project
   * turned on since joins on its current install, one turned off leaves, and an install no pin holds any more goes.
   * A pin on an install whose
   * files are gone here moves to the current one; a session whose install is lost does not start (BTN-1542): Claude
   * would run without the plugin and nobody would know, Codex fails on its missing `plugin.json`.
   */
  startOf(project: string, task: string, agent: string): Pick<SessionStart, 'mcp' | 'plugins'> {
    const places = { gateway: this.gateway.origin, cache: this.deps.cache, projectId: project, builtIn: this.builtIn }
    const moved = this.unpinLost(project, task)
    const found = sessionPackages(this.file, project, task, places, readsFileMemory(agent))
    if (moved || !sameInstalls(this.file.pins[project]?.[task] ?? {}, found.installs)) {
      if (Object.keys(found.installs).length > 0) (this.file.pins[project] ??= {})[task] = found.installs
      else this.unpin(project, task)
      this.prune()
      this.save()
    }
    this.ready(project, found.installs)
    return { mcp: found.mcp, plugins: found.plugins }
  }

  /**
   * What a project chat's session gets (BTN-1694): the project's set as a chain session's, on the current installs and
   * pinned to nothing — a chat has no end a pin would wait for, so its next start takes the installs current then.
   * `own` — the chat's own choice over the set (BTN-1696); a package not in the catalog any more is simply not there.
   */
  chatStartOf(project: string, agent: string, own: OwnPackages = {}): Pick<SessionStart, 'mcp' | 'plugins'> {
    const places = { gateway: this.gateway.origin, cache: this.deps.cache, projectId: project, builtIn: this.builtIn }
    const found = sessionPackages(this.file, project, null, places, readsFileMemory(agent), own)
    this.ready(project, found.installs)
    return { mcp: found.mcp, plugins: found.plugins }
  }

  /** Throws for an install whose files are gone here; writes a plugin's marketplace on its first session. */
  private ready(project: string, installs: Record<string, string>): void {
    for (const [name, id] of Object.entries(installs)) {
      const record = this.file.packages[name]!
      const install = record.installs.find((each) => each.id === id)!
      const lost = this.installs.lostIn(project, name, install)
      if (lost !== undefined) {
        const params = { name, version: install.version ?? id }
        throw lost.marketplace === undefined ? fail('packages.lost', params) : fail('packages.lostMarketplace', { ...params, marketplace: lost.marketplace })
      }
      if (record.plugin !== undefined) ensureMarketplace(this.deps.cache, name, id, record.plugin.name)
    }
  }

  /** Whether a session's `plugins` bring the built-in one, whose hooks ask for the chat's mail mid-turn. */
  bringsMail(plugins: SessionPlugin[] | undefined): boolean {
    return this.builtIn !== undefined && plugins?.some((each) => each.package === this.builtIn) === true
  }

  /** Whether the task's session started with the built-in plugin, by the pin its last start left (BTN-1506). */
  pinsMail(project: string, task: string): boolean {
    return this.builtIn !== undefined && this.file.pins[project]?.[task]?.[this.builtIn] !== undefined
  }

  /** Whether a project chat starts with the built-in plugin: it is in every project's set while it has an install. */
  chatsMail(): boolean {
    const record = this.builtIn === undefined ? undefined : this.file.packages[this.builtIn]
    return record?.plugin !== undefined && record.removed !== true && current(record) !== undefined
  }

  /**
   * `enabledPlugins: false` for every plugin the settings files enable and the task's set does not bring; `task` null —
   * a project chat's (`chatStartOf`), with its `own` choice.
   */
  otherPlugins(project: string, task: string | null, settings: (Record<string, unknown> | undefined)[], own: OwnPackages = {}): Record<string, false> {
    const set = Object.keys(installsFor(this.file, project, task, this.builtIn, own)).flatMap((name) => {
      const plugin = this.file.packages[name]?.plugin
      return plugin === undefined ? [] : [pluginKey(plugin.name, plugin.marketplace)]
    })
    return otherPlugins(settings, set)
  }

  /** The plugins and servers the project's sessions get from its set now. */
  reach(project: string): SessionReach {
    return sessionReach(this.file, project)
  }

  /** The task is done: its pins go, and with them the installs nothing holds any more. */
  release(project: string, task: string): void {
    if (this.file.pins[project]?.[task] === undefined) return
    this.unpin(project, task)
    this.prune()
    this.save()
  }

  /** The task's pins on installs whose files are gone here and that are not current go: it takes the current ones. */
  private unpinLost(project: string, task: string): boolean {
    const pinned = this.file.pins[project]?.[task]
    let moved = false
    for (const [name, id] of Object.entries(pinned ?? {})) {
      const record = this.file.packages[name]
      const install = record?.installs.find((each) => each.id === id)
      const now = record === undefined ? undefined : current(record)
      if (install === undefined || now === undefined || now.id === id || this.installs.lostIn(project, name, install) === undefined) continue
      delete pinned![name]
      moved = true
      this.deps.log(`packages: ${task} was pinned to ${name} ${id}, whose files are gone: moved to ${now.id}`)
    }
    return moved
  }

  private unpin(project: string, task: string): void {
    const tasks = this.file.pins[project]
    if (tasks === undefined) return
    delete tasks[task]
    if (Object.keys(tasks).length === 0) delete this.file.pins[project]
  }

  async install(name: string): Promise<void> {
    this.recordOf(name)
    await this.installs.installNew(name)
  }

  /** A new install next to the current one when the plugin's or a server's version changed; the page shows which. */
  async update(name: string): Promise<void> {
    const record = this.recordOf(name)
    if (record.plugin !== undefined) {
      const place = locatePlugin(this.deps.globalDir, record.plugin.name, record.plugin.marketplace, this.local)
      if (FETCHED.has(place.kind)) {
        try {
          await this.deps.updateMarketplace(record.plugin.marketplace)
        } catch (error) {
          throw fail('packages.marketplaceUpdate', { marketplace: record.plugin.marketplace }, { detail: (error as Error).message }, { cause: error })
        }
        this.offers = undefined
      }
    }
    const install = await this.installs.installNew(name)
    const changed = install === null ? 0 : (this.installs.changedDependencies.get(name) ?? 0)
    const version = install?.version ?? install?.id ?? ''
    this.notes.set(
      name,
      install === null ? notice('packages.upToDate', { name }) : changed > 0 ? notice('packages.updatedDependencies', { name, version, changed }) : notice('packages.updated', { name, version }),
    )
    this.deps.onChange()
  }

  /**
   * Check all of the catalog: every fetched marketplace of an installed plugin is fetched again, once each, and the
   * page shows the newer versions; nothing is installed — that is Update. Every marketplace is tried, the first failure thrown.
   */
  async checkAll(): Promise<void> {
    const fetched = new Set<string>()
    for (const [name, record] of Object.entries(this.file.packages)) {
      if (record.plugin === undefined || record.removed === true || current(record) === undefined) continue
      try {
        if (FETCHED.has(locatePlugin(this.deps.globalDir, record.plugin.name, record.plugin.marketplace, this.local).kind)) fetched.add(record.plugin.marketplace)
      } catch {
        this.deps.log(`packages: ${name}: its marketplace is not found, not checked`)
      }
    }
    let first: unknown
    for (const marketplace of fetched) {
      try {
        await this.deps.updateMarketplace(marketplace)
      } catch (error) {
        this.deps.log(`packages: the marketplace ${marketplace} not fetched: ${(error as Error).message}`)
        first ??= fail('packages.marketplaceUpdate', { marketplace }, { detail: (error as Error).message }, { cause: error })
      }
    }
    this.plugins = undefined
    this.offers = undefined
    this.deps.onChange()
    if (first !== undefined) throw first
  }

  remove(name: string): void {
    this.notBuiltIn(name)
    this.recordOf(name).removed = true
    for (const set of Object.values(this.file.projects)) {
      set.on = set.on.filter((each) => each !== name)
      set.off = set.off.filter((each) => each !== name)
      delete set.settings[name]
    }
    this.prune()
    this.save()
  }

  /** On in every project, or only in `project`. */
  addPlugin(plugin: string, marketplace: string, project?: string): void {
    this.projectKnown(project)
    const name = pluginKey(plugin, marketplace)
    const known = this.file.packages[name]
    if (known !== undefined && known.removed !== true) throw fail('packages.exists', { name })
    locatePlugin(this.deps.globalDir, plugin, marketplace, this.local)
    this.file.packages[name] = { kind: 'plugin', plugin: { name: plugin, marketplace }, default: project === undefined, settings: {}, installs: known?.installs ?? [] }
    this.installAdded(name, project)
  }

  addServer(name: string, entry: ServerEntry, project?: string): void {
    this.projectKnown(project)
    if (!SERVER_NAME.test(name)) throw fail('packages.badName', { name })
    if (typeof entry.command !== 'string' && typeof entry.url !== 'string') throw fail('packages.badServer', { name })
    const known = this.file.packages[name]
    if (known !== undefined && known.removed !== true) throw fail('packages.exists', { name })
    this.file.packages[name] = { kind: 'mcp', server: entry, default: project === undefined, settings: {}, installs: known?.installs ?? [] }
    this.installAdded(name, project)
  }

  /** The install starts before the page is told: a new package shows as installing, not as not installed for a moment. */
  private installAdded(name: string, project?: string): void {
    void this.install(name).catch(() => {})
    if (project !== undefined) this.choose(project, name, 'on')
    else this.save()
  }

  /** The servers of the repository's committed `.mcp.json` join the catalog, on for that project only. */
  importRepo(project: string): void {
    this.projectKnown(project)
    const servers = serversIn(readJson(join(this.deps.repos[project]!, '.mcp.json')))
    for (const [name, entry] of Object.entries(servers)) {
      if (this.imports[project]?.includes(name) && typeof entry === 'object' && entry !== null) this.addServer(name, entry as ServerEntry, project)
    }
    this.imports = { ...this.imports, [project]: [] }
    this.deps.onChange()
  }

  choose(project: string, name: string, choice: 'on' | 'off' | null): void {
    this.projectKnown(project)
    this.recordOf(name)
    this.notBuiltIn(name)
    const set = (this.file.projects[project] ??= { on: [], off: [], settings: {} })
    set.on = set.on.filter((each) => each !== name)
    set.off = set.off.filter((each) => each !== name)
    if (choice !== null) set[choice].push(name)
    this.save()
  }

  setDefault(name: string, on: boolean): void {
    this.notBuiltIn(name)
    this.recordOf(name).default = on
    this.save()
  }

  /** npm runs the install scripts of the package's pinned servers from its next install on; the current one stays. */
  setScripts(name: string, on: boolean): void {
    const record = this.recordOf(name)
    if (on) record.scripts = true
    else delete record.scripts
    this.notes.delete(name)
    this.save()
  }

  /** A setting of the package, for every project (`project` undefined) or one; `null` — back to the package's value. */
  setSetting(name: string, key: string, value: string | null, project?: string): void {
    this.projectKnown(project)
    const record = this.recordOf(name)
    if (project === undefined) {
      if (value === null || value === defaultsOf(record)[key]) delete record.settings[key]
      else record.settings[key] = value
    } else {
      const set = (this.file.projects[project] ??= { on: [], off: [], settings: {} })
      const own = (set.settings[name] ??= {})
      if (value === null || value === packageSettings(record)[key]) delete own[key]
      else own[key] = value
      if (Object.keys(own).length === 0) delete set.settings[name]
    }
    this.probes.forget(name)
    this.save()
  }

  /** Into Even Keel's `.env` and the running service: the gateway uses it at once, a tracker adapter once the watch of `.env` applies it. */
  setKey(name: string, value: string): void {
    if (!this.keys().some((key) => key.name === name)) throw fail('packages.unknownKey', { name })
    let text = ''
    try {
      text = readFileSync(this.deps.envFile, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    writeFileSync(this.deps.envFile, upsertEnv(text, name, value))
    process.env[name] = value
    for (const record of Object.keys(this.file.packages)) this.probes.forget(record)
    this.deps.onChange()
  }

  /**
   * The profiles changed, or a chain started or resumed (BTN-1518): a server that failed is asked again at once, not
   * after its backoff.
   */
  retryProbes(): void {
    this.probes.retry()
  }

  /** Runs one pass of reads, such as one computation of the machine's facts: each project's set is checked once in it. */
  pass<T>(body: () => T): T {
    return this.checks.run(body)
  }

  private check(project: string): ProjectPackages {
    return this.checks.of(project, () => this.checkNow(project))
  }

  private checkNow(project: string): ProjectPackages {
    let pool: NodeJS.ProcessEnv | undefined
    const view = projectPackages({
      file: this.file,
      project,
      agent: this.deps.agentOf(project),
      installing: this.installs.installing,
      errors: this.installs.errors,
      lost: (name, install) => this.installs.lostIn(project, name, install),
      keys: (server, entry, name, install) => this.deps.hubServers?.().includes(routeOf(project, name, install, server))
        ? { values: {}, env: {}, missing: [], names: [] }
        : keysOf(server, this.deps.oauth?.(project, server, entry.url) ? withoutAuthorization(entry) : entry, this.deps.rules, (pool ??= this.deps.poolOf(project))),
      probe: (name, install, server) => this.probes.result(project, name, install, server),
      tracker: this.deps.tracker(project),
    })
    return this.gatewayError === null ? view : { ...view, blocked: true }
  }

  private keys(): KeyView[] {
    const keys = new Map<string, Set<string>>()
    // A tracker's variables are its profiles' (BTN-200), set on the "Access" tab, not here.
    const trackers = new Set([...this.deps.rules.trackers.flatMap((tracker) => tracker.variables), ...Object.values(this.deps.rules.aliases)])
    for (const [name, record] of Object.entries(this.file.packages)) {
      if (record.removed === true) continue
      for (const [server, { entry }] of Object.entries(current(record)?.servers ?? {})) {
        for (const key of keysOf(server, entry, this.deps.rules, process.env).names) if (!trackers.has(key)) keys.set(key, (keys.get(key) ?? new Set()).add(name))
      }
    }
    return [...keys].map(([name, packages]) => ({ name, set: Boolean(process.env[name]), packages: [...packages] })).sort((a, b) => a.name.localeCompare(b.name))
  }

  /** The install the route names, with the project's settings and the pool's keys in its entry. */
  private target(route: { project: string; name: string; install: string; server: string }): GatewayTarget | null {
    return packageTarget(this.file, this.deps, route)
  }

  /** Old installs nothing pins lose their files; a removed package goes once none of its installs is pinned. */
  private prune(): void {
    for (const { name, id } of unpinned(this.file)) {
      const record = this.file.packages[name]!
      rmSync(join(this.deps.cache, name, id), { recursive: true, force: true })
      record.installs = record.installs.filter((each) => each.id !== id)
    }
    for (const [name, record] of Object.entries(this.file.packages)) {
      if (record.removed === true && record.installs.length === 0) delete this.file.packages[name]
    }
  }

  private async readImports(): Promise<void> {
    this.imports = await repoImports(this.deps.repos, this.file)
    this.deps.onChange()
  }

  private recordOf(name: string) {
    const record = this.file.packages[name]
    if (record === undefined || record.removed === true) throw fail('packages.unknown', { name })
    return record
  }

  /** The built-in package has no switches and no removal: every project has it. */
  private notBuiltIn(name: string): void {
    if (name === this.builtIn) throw fail('packages.builtIn', { name })
  }

  private projectKnown(project: string | undefined): void {
    if (project !== undefined && this.deps.repos[project] === undefined) throw fail('chain.unknownProject', { project })
  }

  private save(): void {
    savePackages(this.deps.file, this.file)
    this.deps.onChange()
  }
}

function sameInstalls(a: Record<string, string>, b: Record<string, string>): boolean {
  const names = Object.keys(a)
  return names.length === Object.keys(b).length && names.every((name) => a[name] === b[name])
}
