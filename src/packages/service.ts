import { execFile } from 'node:child_process'
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { SessionStart } from '../agent/contract.js'
import { fail, notice, noticeOf, type Notice } from '../notice/notice.js'
import type { KeyView, PackagesView, PackageView, ProjectPackages } from '../state.js'
import { bringsServer, Probes, projectPackages } from './check.js'
import { McpGateway, type GatewayTarget } from './gateway.js'
import { applySettings, defaultSettings, keysOf, substitute, upsertEnv, type KeyRules } from './keys.js'
import { ensureMarketplace, otherPlugins, pluginDir, routeOf, sessionPackages, sessionReach } from './launch.js'
import { current, enabledPackages, pluginKey, settingsOf, unpinned, type InstalledServer, type PackageInstall, type PackagesFile, type ServerEntry, type SessionReach } from './model.js'
import { installPinned, parseNpx, resolveVersion } from './npm.js'
import { availablePlugins, FETCHED, hasExtras, knowsMarketplace, locatePlugin, ownMarketplace, pluginOffer, pluginServers, pluginVersion, readJson, seedPackages, serversIn } from './plugins.js'
import { chosenSkills, listSkills, readsOwnSkills, rewrapSkills, skillsChanged, SKILLS_MARKETPLACE, SKILLS_PACKAGE, SKILLS_PLUGIN, wrappedSkills, wrapSkills, type SkillRoot } from './skills.js'
import { loadPackages, savePackages } from './store.js'
import { isNewer } from './version.js'

const run = promisify(execFile)
const SERVER_NAME = /^[\w-]+$/
/** How long the marketplaces' plugin lists and versions are kept before they are read again. */
const AVAILABLE_MS = 60_000

type Offer = ReturnType<typeof pluginOffer>

export interface PackagesDeps {
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
  /** `state/skills`: the marketplace of the user's own skills, wrapped into one plugin (BTN-339). */
  skillsDir: string
  /** The user's skills folders, Claude Code's first: what the page offers to wrap. */
  skillRoots: () => SkillRoot[]
  /** `.claude.json` files sessions read: their user scope servers seed the catalog. */
  claudeConfigs: () => string[]
  rules: KeyRules
  /** The MCP server of the project's tracker; `required` — `brief` is off, so its sessions cannot do without it. */
  tracker: (project: string) => { server: string; required: boolean } | undefined
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
  port: number
  log: (line: string) => void
  /** The view or what a project is held on changed. */
  onChange: () => void
}

/** Packages of the projects (BTN-174): the catalog, each project's set, the pins of running tasks, the keys and the gateway. */
export class Packages {
  private file: PackagesFile
  private readonly installing = new Set<string>()
  private readonly errors = new Map<string, Notice>()
  /** The outcome of each package's last update. */
  private readonly notes = new Map<string, Notice>()
  private readonly gateway: McpGateway
  private readonly probes: Probes
  private gatewayError: Notice | null = null
  private imports: Record<string, string[]> = {}
  private plugins: { at: number; list: PackagesView['available']; marketplace: PackagesView['marketplace']; skills: PackagesView['skills']['list'] } | undefined
  private offers: { at: number; byName: Map<string, Offer> } | undefined

  constructor(private readonly deps: PackagesDeps) {
    const loaded = loadPackages(deps.file)
    this.file = loaded ?? this.seed()
    if (loaded === undefined) savePackages(deps.file, this.file)
    this.gateway = new McpGateway({ resolve: (route) => this.target(route), baseEnv: deps.baseEnv, log: deps.log })
    this.probes = new Probes({
      urlOf: (project, name, install, server) => `${this.gateway.origin}${routeOf(project, name, install, server)}`,
      now: () => Date.now(),
      onChange: deps.onChange,
    })
  }

  /** Listens, installs every package with no install yet and reads the repositories' `.mcp.json` to offer. */
  async start(): Promise<void> {
    try {
      await this.gateway.listen(this.deps.port)
      this.deps.log(`mcp gateway: listening on ${this.gateway.origin}`)
    } catch (error) {
      this.gatewayError = noticeOf(error)
      this.deps.log(`mcp gateway: ${(error as Error).message}`)
    }
    for (const [name, record] of Object.entries(this.file.packages)) if (record.removed !== true && record.installs.length === 0) void this.install(name).catch(() => {})
    await this.readImports()
  }

  close(): Promise<void> {
    return this.gateway.close()
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
        installed: install !== undefined,
        version: install?.version ?? null,
        latest: install !== undefined && offer !== undefined && (name === SKILLS_PACKAGE ? skillsChanged : isNewer)(offer.version, install.version) ? offer.version : null,
        fetched: offer?.fetched ?? null,
        installing: this.installing.has(name),
        error: this.errors.get(name) ?? null,
        note: this.notes.get(name) ?? null,
        default: record.default,
        settings: record.settings,
        servers: Object.keys(install?.servers ?? {}),
        extras: install?.extras ?? false,
        removed: record.removed === true,
      }
    })
    const projects = Object.fromEntries(Object.keys(this.deps.repos).map((project) => [project, this.check(project)]))
    const { marketplace, skills } = this.marketplaces()
    return { gateway: this.gatewayError, packages, projects, keys: this.keys(), available: this.available(), marketplace, imports: this.imports, skills: { package: SKILLS_PACKAGE, list: skills } }
  }

  /** The marketplaces' plugins not in the catalog; the user's skills are added by their own step. */
  private available(): PackagesView['available'] {
    return this.marketplaces().list.filter((each) => {
      const known = this.file.packages[pluginKey(each.plugin, each.marketplace)]
      return each.marketplace !== SKILLS_MARKETPLACE && (known === undefined || known.removed === true)
    })
  }

  /** Even Keel's checkout, then the user's wrapped skills. */
  private get local(): string[] {
    return [this.deps.ownDir, this.deps.skillsDir]
  }

  /**
   * The marketplaces' plugins, whether Claude Code knows Even Keel's own, and the user's skills; the files are read
   * again at most once a minute, and the wrapped skills copied again then, so an edit of one shows as an update.
   */
  private marketplaces(): NonNullable<Packages['plugins']> {
    if (this.plugins === undefined || Date.now() - this.plugins.at > AVAILABLE_MS) {
      if (this.wrapsSkills()) this.rewrap()
      const name = ownMarketplace(this.deps.ownDir)
      const marketplace = name === undefined ? null : { name, dir: this.deps.ownDir, known: knowsMarketplace(this.deps.globalDir, name) }
      this.plugins = { at: Date.now(), list: availablePlugins(this.deps.globalDir, this.local), marketplace, skills: this.ownSkills() }
    }
    return this.plugins
  }

  /** The catalog has the package of the user's skills. */
  private wrapsSkills(): boolean {
    const record = this.file.packages[SKILLS_PACKAGE]
    return record !== undefined && record.removed !== true
  }

  private ownSkills(): PackagesView['skills']['list'] {
    const wrapped = new Set(this.wrapsSkills() ? wrappedSkills(this.deps.skillsDir) : [])
    const found = listSkills(this.deps.skillRoots())
    const gone = [...wrapped].filter((name) => !found.some((skill) => skill.name === name)).map((name) => ({ name, from: null, wrapped: true }))
    return [...found.map(({ name, from }) => ({ name, from, wrapped: wrapped.has(name) })), ...gone]
  }

  /** The wrapped skills from their folders again; a failure leaves the last copy and is logged. */
  private rewrap(): void {
    try {
      rewrapSkills(this.deps.skillsDir, this.deps.skillRoots())
    } catch (error) {
      this.deps.log(`packages: the skills of ${SKILLS_PACKAGE} not copied again: ${(error as Error).message}`)
    }
  }

  /**
   * The chosen skills become the plugin `my-skills` of the marketplace in `state/skills/`: a new package, on in every
   * project or in `project`, or a new install of the one in the catalog, whose projects stay as they are.
   */
  async wrapSkills(names: string[], project?: string): Promise<void> {
    this.projectKnown(project)
    const unique = [...new Set(names)]
    if (unique.length === 0) throw fail('packages.noSkills', {})
    const chosen = chosenSkills(this.deps.skillsDir, this.deps.skillRoots(), unique)
    const missing = unique.find((name) => !chosen.some((skill) => skill.name === name))
    if (missing !== undefined) throw fail('packages.unknownSkill', { name: missing })
    try {
      wrapSkills(this.deps.skillsDir, chosen)
    } catch (error) {
      throw fail('packages.copyFailed', { name: SKILLS_PACKAGE }, { detail: (error as Error).message }, { cause: error })
    }
    this.deps.log(`packages: ${SKILLS_PACKAGE} wraps ${unique.join(', ')}`)
    this.plugins = undefined
    this.offers = undefined
    if (this.wrapsSkills()) await this.update(SKILLS_PACKAGE)
    else this.addPlugin(SKILLS_PLUGIN, SKILLS_MARKETPLACE, project)
  }

  /** Even Keel's own marketplace into Claude Code, for the sessions started by hand; chain sessions do without it. */
  async addMarketplace(): Promise<void> {
    const name = ownMarketplace(this.deps.ownDir)
    if (name === undefined) throw fail('packages.noOwnMarketplace', { dir: this.deps.ownDir })
    try {
      await this.deps.addMarketplace(this.deps.ownDir)
    } catch (error) {
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

  /** The chain waits while the project's set has a problem that holds it. */
  blocked(project: string): boolean {
    return this.gatewayError !== null || this.check(project).blocked
  }

  /**
   * What a session of the task gets on the agent; the first one pins the task to the installs it starts on. Claude Code
   * goes without the user's wrapped skills: it reads them from its account folder.
   */
  startOf(project: string, task: string, agent: string): Pick<SessionStart, 'mcp' | 'plugins'> {
    const places = { gateway: this.gateway.origin, cache: this.deps.cache, projectId: project }
    const found = sessionPackages(this.file, project, task, places)
    if (this.file.pins[project]?.[task] === undefined && Object.keys(found.installs).length > 0) {
      ;(this.file.pins[project] ??= {})[task] = found.installs
      this.save()
    }
    for (const [name, id] of Object.entries(found.installs)) {
      const plugin = this.file.packages[name]?.plugin
      if (plugin !== undefined) ensureMarketplace(this.deps.cache, name, id, plugin.name)
    }
    const skip = readsOwnSkills(agent) ? pluginDir(this.deps.cache, SKILLS_PACKAGE, found.installs[SKILLS_PACKAGE] ?? '') : undefined
    return { mcp: found.mcp, plugins: found.plugins.filter((each) => each.dir !== skip) }
  }

  /** `enabledPlugins: false` for every plugin the settings files enable and the task's set does not bring. */
  otherPlugins(project: string, task: string, settings: (Record<string, unknown> | undefined)[]): Record<string, false> {
    const pinned = this.file.pins[project]?.[task]
    const names = pinned === undefined ? enabledPackages(this.file, project) : Object.keys(pinned)
    const set = names.flatMap((name) => {
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
    const tasks = this.file.pins[project]
    if (tasks?.[task] === undefined) return
    delete tasks[task]
    if (Object.keys(tasks).length === 0) delete this.file.pins[project]
    this.prune()
    this.save()
  }

  async install(name: string): Promise<void> {
    this.recordOf(name)
    await this.installNew(name)
  }

  /** A new install next to the current one when the plugin's or a server's version changed; the page shows which. */
  async update(name: string): Promise<void> {
    const record = this.recordOf(name)
    if (name === SKILLS_PACKAGE) this.rewrap()
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
    const install = await this.installNew(name)
    this.notes.set(name, install === null ? notice('packages.upToDate', { name }) : notice('packages.updated', { name, version: install.version ?? install.id }))
    this.deps.onChange()
  }

  remove(name: string): void {
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
    this.file.packages[name] = { kind: 'mcp', server: entry, default: project === undefined, settings: defaultSettings({ [name]: entry }), installs: known?.installs ?? [] }
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
    const set = (this.file.projects[project] ??= { on: [], off: [], settings: {} })
    set.on = set.on.filter((each) => each !== name)
    set.off = set.off.filter((each) => each !== name)
    if (choice !== null) set[choice].push(name)
    this.save()
  }

  setDefault(name: string, on: boolean): void {
    this.recordOf(name).default = on
    this.save()
  }

  /** A setting of the package, for every project (`project` undefined) or one; `null` — back to the package's value. */
  setSetting(name: string, key: string, value: string | null, project?: string): void {
    this.projectKnown(project)
    const record = this.recordOf(name)
    if (project === undefined) {
      if (value === null) delete record.settings[key]
      else record.settings[key] = value
    } else {
      const set = (this.file.projects[project] ??= { on: [], off: [], settings: {} })
      const own = (set.settings[name] ??= {})
      if (value === null || value === record.settings[key]) delete own[key]
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

  private check(project: string): ProjectPackages {
    const view = projectPackages({
      file: this.file,
      project,
      agent: this.deps.agentOf(project),
      installing: this.installing,
      errors: this.errors,
      keys: (server, entry) => keysOf(server, entry, this.deps.rules, this.deps.poolOf(project)),
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
    const project = route.project
    const record = this.file.packages[route.name]
    const server = record?.installs.find((each) => each.id === route.install)?.servers[route.server]
    if (server === undefined) return null
    const entry = applySettings(server.entry, settingsOf(this.file, project, route.name))
    const keys = keysOf(route.server, entry, this.deps.rules, this.deps.poolOf(project))
    return { entry: substitute(entry, keys.values), npm: server.npm?.name ?? null, env: keys.env }
  }

  /** `null` — the versions are those of the current install: nothing new is kept. */
  private async installNew(name: string): Promise<PackageInstall | null> {
    if (this.installing.has(name)) throw fail('packages.busy', { name })
    const record = this.recordOf(name)
    const id = Date.now().toString(36)
    const home = join(this.deps.cache, name, id)
    this.installing.add(name)
    this.errors.delete(name)
    this.deps.onChange()
    const started = Date.now()
    const seconds = () => Math.round((Date.now() - started) / 1000)
    this.deps.log(`packages: installing ${name}`)
    try {
      let entries: Record<string, ServerEntry>
      let version: string | null = null
      let extras = false
      if (record.plugin !== undefined) {
        const place = locatePlugin(this.deps.globalDir, record.plugin.name, record.plugin.marketplace, this.local)
        const dir = pluginDir(this.deps.cache, name, id)
        try {
          cpSync(place.dir, dir, { recursive: true, filter: (source) => !/[\\/]\.git$/.test(source) })
        } catch (error) {
          throw fail('packages.copyFailed', { name }, { detail: (error as Error).message }, { cause: error })
        }
        entries = pluginServers(dir)
        version = pluginVersion(dir)
        extras = hasExtras(dir)
      } else entries = { [name]: record.server ?? {} }
      const planned: Record<string, { entry: ServerEntry; spec: ReturnType<typeof parseNpx>; npm: string | null }> = {}
      for (const [server, entry] of Object.entries(entries)) {
        const spec = parseNpx(entry)
        planned[server] = { entry, spec, npm: spec === null ? null : await resolveVersion(spec) }
      }
      version ??= Object.values(planned).find((each) => each.npm !== null)?.npm ?? null
      const last = current(record)
      if (last !== undefined && last.version === version && sameServers(last.servers, planned)) {
        rmSync(home, { recursive: true, force: true })
        return null
      }
      const servers: Record<string, InstalledServer> = {}
      for (const [server, { entry, spec, npm }] of Object.entries(planned)) {
        if (spec === null || npm === null) servers[server] = { entry, npm: null }
        else {
          const at = seconds()
          servers[server] = await installPinned(entry, spec, npm, join(home, 'servers', server))
          this.deps.log(`packages: ${name}: npm install ${spec.name}@${npm} took ${seconds() - at} s`)
        }
      }
      const install: PackageInstall = { id, version, at: new Date().toISOString(), servers, extras }
      record.installs.push(install)
      record.settings = { ...defaultSettings(Object.fromEntries(Object.entries(servers).map(([server, each]) => [server, each.entry]))), ...record.settings }
      this.prune()
      this.save()
      this.deps.log(`packages: ${name} ${version ?? id} installed in ${seconds()} s`)
      return install
    } catch (error) {
      rmSync(home, { recursive: true, force: true })
      this.errors.set(name, noticeOf(error))
      this.deps.log(`packages: ${name} not installed: ${(error as Error).message}`)
      throw error
    } finally {
      this.installing.delete(name)
      this.deps.onChange()
    }
  }

  /** Old installs nothing pins lose their files; a removed package goes once none of its installs is pinned. */
  private prune(): void {
    for (const { name, id } of unpinned(this.file)) {
      const record = this.file.packages[name]!
      rmSync(join(this.deps.cache, name, id), { recursive: true, force: true })
      record.installs = record.installs.filter((each) => each.id !== id)
      if (record.removed === true && record.installs.length === 0) delete this.file.packages[name]
    }
  }

  private seed(): PackagesFile {
    const settingsOf = (repo: string) => [readJson(join(repo, '.claude', 'settings.json')), readJson(join(repo, '.claude', 'settings.local.json'))].filter((each) => each !== undefined)
    const userServers = Object.assign({}, ...this.deps.claudeConfigs().map((file) => serversIn({ mcpServers: readJson(file)?.mcpServers })).reverse())
    const seeded = seedPackages({
      globalSettings: readJson(join(this.deps.globalDir, 'settings.json')),
      projects: Object.entries(this.deps.repos).map(([key, repo]) => ({ key, settings: settingsOf(repo) })),
      userServers,
    })
    this.deps.log(`packages: no ${this.deps.file}; the catalog is seeded with ${Object.keys(seeded.packages).join(', ') || 'nothing'}`)
    return seeded
  }

  private async readImports(): Promise<void> {
    const imports: Record<string, string[]> = {}
    for (const [project, repo] of Object.entries(this.deps.repos)) {
      try {
        const { stdout } = await run('git', ['-C', repo, 'ls-files', '--', '.mcp.json'], { windowsHide: true })
        if (stdout.trim() === '') continue
      } catch {
        continue
      }
      const names = Object.keys(serversIn(readJson(join(repo, '.mcp.json')))).filter((name) => {
        const known = this.file.packages[name]
        return SERVER_NAME.test(name) && (known === undefined || known.removed === true)
      })
      if (names.length > 0) imports[project] = names
    }
    this.imports = imports
    this.deps.onChange()
  }

  private recordOf(name: string) {
    const record = this.file.packages[name]
    if (record === undefined || record.removed === true) throw fail('packages.unknown', { name })
    return record
  }

  private projectKnown(project: string | undefined): void {
    if (project !== undefined && this.deps.repos[project] === undefined) throw fail('chain.unknownProject', { project })
  }

  private save(): void {
    savePackages(this.deps.file, this.file)
    this.deps.onChange()
  }
}

/** The same servers: a pinned one at the same npm version, any other with the same entry. */
function sameServers(installed: Record<string, InstalledServer>, planned: Record<string, { entry: ServerEntry; npm: string | null }>): boolean {
  if (JSON.stringify(Object.keys(installed).sort()) !== JSON.stringify(Object.keys(planned).sort())) return false
  return Object.entries(planned).every(([name, { entry, npm }]) => {
    const known = installed[name]!
    return npm === null ? known.npm === null && JSON.stringify(known.entry) === JSON.stringify(entry) : known.npm?.version === npm
  })
}
