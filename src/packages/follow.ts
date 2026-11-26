import { routeOf } from './launch.js'
import { current, type PackageInstall, type PackageRecord, type PackagesFile, type ProjectSet } from './model.js'

/**
 * The hub's catalog as a machine elsewhere follows it (BTN-1299): every package of the catalog, each with the hub's
 * current install, and the machine's projects' sets; none for a machine without projects. One its projects have off is
 * there too: a project chat may turn it on (BTN-1741). The settings of a package whose servers all run in the hub stay there.
 */
export interface CatalogBrief {
  packages: Record<string, PackageRecord>
  projects: Record<string, ProjectSet>
}

/** The hub's side: what of its catalog a machine serving `projects` follows; `hubRoutes` — `hubServers()`. */
export function catalogFor(file: PackagesFile, projects: string[], hubRoutes: readonly string[]): CatalogBrief {
  const hub = new Set(hubRoutes)
  const packages: Record<string, PackageRecord> = {}
  const onMachine = new Set<string>()
  for (const [name, record] of Object.entries(file.packages)) {
    if (record.removed === true || projects.length === 0) continue
    const install = current(record)
    const servers = Object.keys(install?.servers ?? {})
    const local = install !== undefined && projects.some((project) => servers.some((server) => !hub.has(routeOf(project, name, install.id, server))))
    if (local) onMachine.add(name)
    const { removed: _removed, installs: _installs, ...definition } = record
    packages[name] = structuredClone({ ...definition, settings: local ? record.settings : {}, installs: install === undefined ? [] : [install] })
  }
  const sets: Record<string, ProjectSet> = {}
  for (const project of projects) {
    const set = file.projects[project]
    if (set === undefined) continue
    sets[project] = { on: [...set.on], off: [...set.off], settings: structuredClone(Object.fromEntries(Object.entries(set.settings).filter(([name]) => onMachine.has(name)))) }
  }
  return { packages, projects: sets }
}

/**
 * The machine's side: its catalog made the hub's. The hub's packages take their definitions, the rest are removed (the
 * built-in one kept), the projects' sets are replaced. A hub install the machine has becomes its current one; the ones
 * it lacks are answered, to be installed here under the hub's ids, so the routes the hub serves name the same install.
 */
export function followCatalog(file: PackagesFile, catalog: CatalogBrief, builtIn?: string): { name: string; install: PackageInstall }[] {
  const missing: { name: string; install: PackageInstall }[] = []
  for (const [name, theirs] of Object.entries(catalog.packages)) {
    const { installs, removed: _removed, ...definition } = structuredClone(theirs)
    const record: PackageRecord = { ...definition, installs: file.packages[name]?.installs ?? [] }
    file.packages[name] = record
    const wanted = installs.at(-1)
    if (wanted === undefined) continue
    const at = record.installs.findIndex((each) => each.id === wanted.id)
    if (at < 0) missing.push({ name, install: wanted })
    else if (at < record.installs.length - 1) record.installs.push(...record.installs.splice(at, 1))
  }
  for (const [name, record] of Object.entries(file.packages)) {
    if (!Object.hasOwn(catalog.packages, name) && name !== builtIn) record.removed = true
  }
  file.projects = structuredClone(catalog.projects)
  return missing
}
