import { isMemoryUrl } from '../memory/mcp.js'
import { isTasksUrl } from '../taskmcp/server.js'
import { hubOwned, McpGateway, withoutAuthorization, type GatewayTarget } from './gateway.js'
import { applySettings, keysOf, substitute } from './keys.js'
import { routeOf } from './launch.js'
import type { PackagesFile } from './model.js'
import type { PackagesDeps } from './service.js'
import { withOverride } from './stdio.js'

type TargetDeps = Pick<PackagesDeps, 'rules' | 'poolOf' | 'oauth' | 'refuseDeletes' | 'serverOverride'>
type Route = { project: string; name: string; install: string; server: string }

export function packageTarget(file: PackagesFile, deps: TargetDeps, route: Route): GatewayTarget | null {
  const project = route.project
  const record = file.packages[route.name]
  const server = record?.installs.find((each) => each.id === route.install)?.servers[route.server]
  if (server === undefined) return null
  const own = withOverride(server.entry, deps.serverOverride?.(project, route.name, route.server))
  let entry = applySettings(own, { ...record?.settings, ...file.projects[project]?.settings[route.name] })
  const oauth = deps.oauth?.(project, route.server, entry.url)
  if (oauth) entry = withoutAuthorization(entry)
  const keys = keysOf(route.server, entry, deps.rules, deps.poolOf(project))
  const refuseDeletes = deps.refuseDeletes?.(project, route.server)
  return { entry: substitute(entry, keys.values), npm: server.npm?.name ?? null, env: keys.env, secrets: Object.values(keys.values), ...(oauth === undefined ? {} : { oauth }), ...(refuseDeletes === undefined ? {} : { refuseDeletes }) }
}

/**
 * The routes of the projects' servers the hub's gateway owns: the hub publishes only these names to machines, never the
 * resolved targets holding its keys. A project's key pool copies the whole environment, so it is read once per project.
 */
export function hubRoutes(file: PackagesFile, deps: TargetDeps, projects: string[]): string[] {
  const pools = new Map<string, NodeJS.ProcessEnv>()
  const kept: TargetDeps = {
    rules: deps.rules,
    poolOf: (project) => pools.get(project) ?? pools.set(project, deps.poolOf(project)).get(project)!,
    ...(deps.oauth !== undefined && { oauth: deps.oauth }),
    ...(deps.refuseDeletes !== undefined && { refuseDeletes: deps.refuseDeletes }),
    ...(deps.serverOverride !== undefined && { serverOverride: deps.serverOverride }),
  }
  const routes: string[] = []
  for (const project of projects) {
    for (const [name, record] of Object.entries(file.packages)) {
      for (const install of record.installs) {
        for (const server of Object.keys(install.servers)) {
          const target = packageTarget(file, kept, { project, name, install: install.id, server })
          // The memory server is the hub's records, never a machine's (BTN-1029).
          if (target !== null && (isMemoryUrl(target.entry.url) || (!isTasksUrl(target.entry.url) && hubOwned(target)))) routes.push(routeOf(project, name, install.id, server))
        }
      }
    }
  }
  return routes
}

/** The hub's gateway owns tracker credentials, OAuth, tasks and memory; the machine only receives its route names. */
export class PackageHub {
  private readonly gateway: McpGateway

  constructor(private readonly deps: TargetDeps & Pick<PackagesDeps, 'repos' | 'baseEnv' | 'tasks' | 'memory' | 'log'> & { catalog: () => PackagesFile }) {
    this.gateway = new McpGateway({ resolve: (route) => packageTarget(deps.catalog(), deps, route), baseEnv: deps.baseEnv, tasks: deps.tasks, memory: deps.memory, log: deps.log })
  }

  start(): Promise<void> { return this.gateway.listen(0) }
  close(): Promise<void> { return this.gateway.close() }
  get hubOrigin(): string | undefined { return this.gateway.listening ? this.gateway.origin : undefined }

  hubServers(): string[] {
    return hubRoutes(this.deps.catalog(), this.deps, Object.keys(this.deps.repos))
  }
}
