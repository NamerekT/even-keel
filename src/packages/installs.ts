import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fail, noticeOf, type Notice } from '../notice/notice.js'
import { routeOf, pluginDir } from './launch.js'
import { current, type InstalledServer, type PackageInstall, type PackageRecord, type PackagesFile, type ServerEntry } from './model.js'
import { copyPinned, dependencyChanges, installPinned, lockOf, parseNpx, resolveVersion, type NpxSpec } from './npm.js'
import { hasExtras, locatePlugin, pluginServers, pluginVersion } from './plugins.js'
import type { PackagesDeps } from './service.js'

/** How long a hub's install that failed here waits before a brief tries it again. */
const FOLLOW_RETRY_MS = 10 * 60_000

/** What the installs take from `Packages`. */
export interface InstallHost {
  deps: Pick<PackagesDeps, 'cache' | 'globalDir' | 'hubServers' | 'repos' | 'log' | 'onChange'>
  file: () => PackagesFile
  /** Even Keel's checkout, then the user's wrapped skills. */
  local: () => string[]
  recordOf: (name: string) => PackageRecord
  /** The package's cached offer goes: the next read finds the folder just copied. */
  forgetOffer: (name: string) => void
  prune: () => void
  save: () => void
}

/** The installs of packages: a new one from the marketplace or npm, and on a machine elsewhere the hub's (BTN-1299). */
export class Installs {
  readonly installing = new Set<string>()
  readonly errors = new Map<string, Notice>()
  /** By package: how many dependencies its last install's npm installs changed against the install before. */
  readonly changedDependencies = new Map<string, number>()
  /** On a machine elsewhere: the hub's current install of each package it follows (BTN-1299), and the last failure of one. */
  private followed = new Map<string, PackageInstall>()
  private readonly followFailed = new Map<string, { id: string; at: number }>()
  /** `<package>/<install>` of the lost installs tried again since the start (`restoreLost`). */
  private readonly restoreTried = new Set<string>()

  constructor(private readonly host: InstallHost) {}

  private get deps(): InstallHost['deps'] {
    return this.host.deps
  }

  /** The hub's current installs from its latest brief. */
  follow(followed: Map<string, PackageInstall>): void {
    this.followed = followed
  }

  /** `null` — the versions are those of the current install: nothing new is kept. */
  async installNew(name: string): Promise<PackageInstall | null> {
    if (this.installing.has(name)) throw fail('packages.busy', { name })
    const record = this.host.recordOf(name)
    const id = Date.now().toString(36)
    const home = join(this.deps.cache, name, id)
    this.installing.add(name)
    this.errors.delete(name)
    this.deps.onChange()
    const started = Date.now()
    const seconds = () => Math.round((Date.now() - started) / 1000)
    this.deps.log(`packages: installing ${name}`)
    try {
      const { entries, extras, ...source } = this.sources(name, record, id)
      let version = source.version
      const planned: Record<string, { entry: ServerEntry; spec: ReturnType<typeof parseNpx>; npm: string | null }> = {}
      for (const [server, entry] of Object.entries(entries)) {
        const spec = parseNpx(entry)
        planned[server] = { entry, spec, npm: spec === null ? null : await resolveVersion(spec) }
      }
      version ??= Object.values(planned).find((each) => each.npm !== null)?.npm ?? null
      const last = current(record)
      const scripts = record.scripts === true
      // The offer is read again from the folder just copied: one cached before it would show Update over the new install.
      this.host.forgetOffer(name)
      if (last !== undefined && last.version === version && sameServers(last.servers, planned) && (last.scripts === true) === scripts) {
        rmSync(home, { recursive: true, force: true })
        return null
      }
      const servers: Record<string, InstalledServer> = {}
      let changed = 0
      for (const [server, { entry, spec, npm }] of Object.entries(planned)) {
        if (spec === null || npm === null) servers[server] = { entry, npm: null }
        else {
          const at = seconds()
          const prefix = join(home, 'servers', server)
          const copied = (last?.scripts === true) === scripts ? await this.copyServer(name, last, server, entry, spec, npm, prefix) : null
          if (copied !== null) {
            servers[server] = copied
            this.deps.log(`packages: ${name}: ${spec.name}@${npm} copied from ${last!.id} in ${seconds() - at} s`)
            continue
          }
          servers[server] = await this.installServer(name, entry, spec, npm, prefix, scripts, () => seconds() - at)
          changed += this.dependenciesChanged(name, server, spec, last, prefix)
        }
      }
      const install: PackageInstall = { id, version, at: new Date().toISOString(), servers, extras, ...(scripts ? { scripts: true as const } : {}) }
      this.changedDependencies.set(name, changed)
      record.installs.push(install)
      this.host.prune()
      this.host.save()
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
      this.materialize(name)
    }
  }

  /** The servers an install of the package starts from: a plugin copied from its marketplace into the install's folder. */
  private sources(name: string, record: PackageRecord, id: string): { entries: Record<string, ServerEntry>; version: string | null; extras: boolean } {
    if (record.plugin === undefined) return { entries: { [name]: record.server ?? {} }, version: null, extras: false }
    const place = locatePlugin(this.deps.globalDir, record.plugin.name, record.plugin.marketplace, this.host.local())
    const dir = pluginDir(this.deps.cache, name, id)
    try {
      cpSync(place.dir, dir, { recursive: true, filter: (source) => !/[\\/]\.git$/.test(source) })
    } catch (error) {
      throw fail('packages.copyFailed', { name }, { detail: (error as Error).message }, { cause: error })
    }
    return { entries: pluginServers(dir), version: pluginVersion(dir), extras: hasExtras(dir) }
  }

  /**
   * The hub's current install of a followed package (BTN-1299), installed here under its id: a pinned server at the
   * hub's npm version, none for a server the hub runs for every project here. A failure is tried again after a while.
   */
  materialize(name: string): void {
    const theirs = this.followed.get(name)
    const failed = this.followFailed.get(name)
    if (theirs === undefined || this.installing.has(name) || (failed?.id === theirs.id && Date.now() - failed.at < FOLLOW_RETRY_MS)) return
    const record = this.host.file().packages[name]
    if (record === undefined || record.removed === true || record.installs.some((each) => each.id === theirs.id)) return
    this.deps.log(`packages: installing ${name} ${theirs.version ?? theirs.id} as the hub has it`)
    this.installAs(name, record, theirs, {
      leaveToHub: true,
      place: (installs, install) => {
        const placed = [...installs.filter((each) => each.id !== theirs.id), install]
        // The hub may have moved to an install this machine has while this one ran: that one stays current.
        const latest = this.followed.get(name)
        const at = latest === undefined ? -1 : placed.findIndex((each) => each.id === latest.id)
        if (at >= 0) placed.push(...placed.splice(at, 1))
        return placed
      },
      settled: (error) => {
        if (error === undefined) this.followFailed.delete(name)
        else {
          this.followFailed.set(name, { id: theirs.id, at: Date.now() })
          this.deps.log(`packages: ${name} not installed as the hub has it: ${error.message}`)
        }
        this.materialize(name)
      },
    })
  }

  /**
   * Installs whose folder is gone, as after a state folder restored on another host (the folders hold npm installs
   * built for the old one's system): each is installed again in its place, under its id and at its npm versions.
   * Tried once per install while the service runs; `name` — only that package's.
   */
  restoreLost(name?: string): void {
    for (const [each, record] of Object.entries(this.host.file().packages)) {
      if ((name !== undefined && each !== name) || record.removed === true || this.installing.has(each)) continue
      const found = this.pluginFound(record)
      let lost: PackageInstall | undefined
      for (const install of record.installs) {
        if (this.restoreTried.has(`${each}/${install.id}`) || !this.folderLost(each, record, install)) continue
        this.restoreTried.add(`${each}/${install.id}`)
        if (found === undefined || found === install.version) {
          lost = install
          break
        }
        this.deps.log(`packages: ${each} ${install.id} lost its folder, and its marketplace has ${found ?? 'no version'} instead of ${install.version}: left for Update`)
      }
      if (lost === undefined) continue
      const target = lost
      this.deps.log(`packages: ${each} ${lost.id} lost its folder: installing it again`)
      this.installAs(each, record, lost, {
        place: (installs, install) => installs.map((old) => (old.id === target.id ? install : old)),
        settled: (error) => {
          if (error !== undefined) this.deps.log(`packages: ${each} ${target.id} not installed again: ${error.message}`)
          this.restoreLost(each)
        },
      })
    }
  }

  /** The version of the package's plugin in its marketplace now; `undefined` — no plugin, `null` — none found. */
  private pluginFound(record: PackageRecord): string | null | undefined {
    if (record.plugin === undefined) return undefined
    try {
      return pluginVersion(locatePlugin(this.deps.globalDir, record.plugin.name, record.plugin.marketplace, this.host.local()).dir)
    } catch {
      return null
    }
  }

  private folderLost(name: string, record: PackageRecord, install: PackageInstall): boolean {
    if (record.plugin !== undefined && !existsSync(pluginDir(this.deps.cache, name, install.id))) return true
    return Object.entries(install.servers).some(([server, { npm }]) => npm !== null && !existsSync(join(this.deps.cache, name, install.id, 'servers', server)))
  }

  /**
   * `theirs` installed here under its id, at its npm versions; `place` puts it into the record's installs. `leaveToHub` —
   * a server the hub runs for every project here keeps the hub's entry and gets no npm install.
   */
  private installAs(
    name: string,
    record: PackageRecord,
    theirs: PackageInstall,
    how: { leaveToHub?: boolean; place: (installs: PackageInstall[], install: PackageInstall) => PackageInstall[]; settled: (error?: Error) => void },
  ): void {
    const home = join(this.deps.cache, name, theirs.id)
    this.installing.add(name)
    this.errors.delete(name)
    this.deps.onChange()
    const started = Date.now()
    const seconds = () => Math.round((Date.now() - started) / 1000)
    let failure: Error | undefined
    void (async () => {
      try {
        const { entries, version, extras } = this.sources(name, record, theirs.id)
        const hub = new Set(this.deps.hubServers?.() ?? [])
        const projects = Object.keys(this.deps.repos)
        const servers: Record<string, InstalledServer> = {}
        for (const [server, their] of Object.entries(theirs.servers)) {
          const entry = entries[server] ?? their.entry
          const spec = parseNpx(entry)
          const onHub = how.leaveToHub === true && projects.length > 0 && projects.every((project) => hub.has(routeOf(project, name, theirs.id, server)))
          if (onHub) servers[server] = their
          else if (their.npm === null || spec === null) servers[server] = { entry, npm: null }
          else servers[server] = await this.installServer(name, entry, spec, their.npm.version, join(home, 'servers', server), theirs.scripts === true, seconds)
        }
        const now = this.host.file().packages[name]
        if (now === undefined || now.removed === true) {
          rmSync(home, { recursive: true, force: true })
          return
        }
        const install: PackageInstall = { id: theirs.id, version: version ?? theirs.version, at: new Date().toISOString(), servers, extras, ...(theirs.scripts === true ? { scripts: true as const } : {}) }
        now.installs = how.place(now.installs, install)
        this.host.prune()
        this.host.save()
        this.deps.log(`packages: ${name} ${install.version ?? install.id} installed in ${seconds()} s`)
      } catch (error) {
        rmSync(home, { recursive: true, force: true })
        this.errors.set(name, noticeOf(error))
        failure = error as Error
      } finally {
        this.installing.delete(name)
        this.deps.onChange()
        how.settled(failure)
      }
    })()
  }

  /** npm install of a pinned server. */
  private async installServer(name: string, entry: ServerEntry, spec: NpxSpec, npm: string, prefix: string, scripts: boolean, took: () => number): Promise<InstalledServer> {
    const server = await installPinned(entry, spec, npm, prefix, scripts)
    this.deps.log(`packages: ${name}: npm install ${spec.name}@${npm}${scripts ? ' with install scripts' : ''} took ${took()} s`)
    return server
  }

  /** The dependencies the new lock of a server changed against the previous install's, logged; their count. */
  private dependenciesChanged(name: string, server: string, spec: NpxSpec, last: PackageInstall | undefined, prefix: string): number {
    if (last?.servers[server]?.npm == null) return 0
    const before = lockOf(join(this.deps.cache, name, last.id, 'servers', server))
    const after = lockOf(prefix)
    if (before === null || after === null) return 0
    const changes = dependencyChanges(before, after, spec.name)
    if (changes.length > 0) this.deps.log(`packages: ${name}/${server}: dependencies changed: ${changes.join(', ')}`)
    return changes.length
  }

  /**
   * The previous install's copy of the same npm version, so a plugin-only update skips npm install;
   * `null` — nothing to copy or the copy failed. The previous install keeps its own folder: a running task may hold it.
   */
  private async copyServer(name: string, last: PackageInstall | undefined, server: string, entry: ServerEntry, spec: NpxSpec, npm: string, prefix: string): Promise<InstalledServer | null> {
    const known = last?.servers[server]?.npm
    if (last === undefined || known?.name !== spec.name || known.version !== npm) return null
    const from = join(this.deps.cache, name, last.id, 'servers', server)
    if (!existsSync(from)) return null
    try {
      return await copyPinned(entry, spec, npm, from, prefix)
    } catch (error) {
      rmSync(prefix, { recursive: true, force: true })
      this.deps.log(`packages: ${name}: ${spec.name}@${npm} not copied from ${last.id}, installing: ${(error as Error).message}`)
      return null
    }
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
