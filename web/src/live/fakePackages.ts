import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, PackageCell, PackageProblem, PackagesView, PackageView } from '../../../src/state.js'

interface FakePackage extends PackageView {
  /** The variables its servers read. */
  keys: string[]
}

interface Catalog {
  packages: FakePackage[]
  choices: Record<string, Record<string, 'on' | 'off'>>
  own: Record<string, Record<string, Record<string, string>>>
  keys: Record<string, boolean>
  imports: Record<string, string[]>
  gateway: boolean
}

const base = { installed: true, latest: null, fetched: null, installing: false, error: null, note: null, removed: false }
const fetched = new Date(Date.now() - 3 * 3_600_000).toISOString()

/**
 * `?packages=`: `blocked` — a key is missing and XYZ waits, `gateway` — the gateway cannot listen, `empty` — no
 * packages; without it everything is ready. OPS runs on Codex, so the Huly plugin is MCP only there.
 */
export function fakePackages(projects: string[], mode: string | null): PackagesView {
  const catalog: Catalog = {
    packages: [
      { ...base, name: 'huly@even-keel', kind: 'plugin', version: '0.4.2', latest: '0.4.3', default: true, settings: { TOOLSETS: 'issues,projects,comments' }, servers: ['huly'], extras: true, keys: ['HULY_EMAIL', 'HULY_PASSWORD'] },
      { ...base, name: 'playwright@claude-plugins-official', kind: 'plugin', version: '1.0.0', fetched, default: false, settings: {}, servers: ['playwright'], extras: false, keys: [] },
      { ...base, name: 'forgejo', kind: 'mcp', version: '2.3.0', default: true, settings: { FORGEJO_URL: 'https://git.example.com' }, servers: ['forgejo'], extras: false, keys: ['FORGEJO_TOKEN'] },
    ],
    choices: { DEMO: { 'playwright@claude-plugins-official': 'on' }, OPS: { forgejo: 'off' } },
    own: { DEMO: { 'huly@even-keel': { TOOLSETS: 'issues' } } },
    keys: { HULY_EMAIL: true, HULY_PASSWORD: true, FORGEJO_TOKEN: mode !== 'blocked', GITHUB_TOKEN: true },
    imports: { DEMO: ['sentry', 'db'] },
    gateway: mode !== 'gateway',
  }
  if (mode === 'empty') catalog.packages = []
  return viewOf(catalog, projects)
}

function viewOf(catalog: Catalog, projects: string[]): PackagesView {
  const view: PackagesView & { catalog: Catalog } = {
    catalog,
    gateway: catalog.gateway ? null : notice('packages.port', { port: 4748 }),
    packages: catalog.packages.map(({ keys: _keys, ...each }) => each),
    projects: Object.fromEntries(projects.map((project) => [project, projectOf(catalog, project)])),
    keys: Object.entries(catalog.keys).map(([name, set]) => ({
      name,
      set,
      packages: catalog.packages.filter((each) => each.keys.includes(name)).map((each) => each.name),
    })),
    available: [
      { plugin: 'linear', marketplace: 'even-keel' },
      { plugin: 'github', marketplace: 'even-keel' },
    ].filter((each) => !catalog.packages.some((known) => known.name === `${each.plugin}@${each.marketplace}`)),
    imports: catalog.imports,
  }
  return view
}

function projectOf(catalog: Catalog, project: string): PackagesView['projects'][string] {
  const cells: Record<string, PackageCell> = {}
  for (const each of catalog.packages) {
    const choice = catalog.choices[project]?.[each.name] ?? null
    const enabled = !each.removed && (choice === null ? each.default : choice === 'on')
    const problems: PackageProblem[] = []
    if (each.installing) problems.push({ kind: 'installing' })
    else if (!each.installed) problems.push({ kind: 'notInstalled' })
    const missing = each.keys.filter((key) => !catalog.keys[key])
    if (missing.length > 0) problems.push({ kind: 'noKey', variables: missing })
    if (each.extras && project === 'OPS') problems.push({ kind: 'unsupported', agent: 'Codex' })
    cells[each.name] = { choice, enabled, settings: { ...each.settings, ...catalog.own[project]?.[each.name] }, problems }
  }
  const problems: PackageProblem[] = cells['huly@even-keel']?.enabled === false ? [{ kind: 'noTrackerMcp', server: 'huly' }] : []
  const blocked = !catalog.gateway || problems.length > 0 || Object.values(cells).some((cell) => cell.enabled && cell.problems.some((each) => each.kind !== 'unsupported'))
  return { cells, problems, blocked }
}

/** The packages' commands; `null` for another command. */
export function fakePackagesCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (!name.startsWith('packages/')) return null
  const catalog = structuredClone((state.packages as PackagesView & { catalog: Catalog }).catalog)
  const target = catalog.packages.find((each) => each.name === body.name)
  const project = typeof body.project === 'string' ? body.project : undefined
  if (name === 'packages/server' && target !== undefined) throw fail('packages.exists', { name: target.name })
  if (name === 'packages/install' && target !== undefined) target.installed = true
  else if (name === 'packages/update' && target !== undefined) {
    if (target.latest === null) target.note = notice('packages.upToDate', { name: target.name })
    else {
      target.note = notice('packages.updated', { name: target.name, version: target.latest })
      target.version = target.latest
      target.latest = null
    }
  } else if (name === 'packages/remove') catalog.packages = catalog.packages.filter((each) => each !== target)
  else if (name === 'packages/plugin') {
    const plugin = `${String(body.plugin)}@${String(body.marketplace)}`
    catalog.packages.push({ ...base, name: plugin, kind: 'plugin', version: '0.1.0', default: project === undefined, settings: {}, servers: [String(body.plugin)], extras: true, keys: [] })
    if (project !== undefined) (catalog.choices[project] ??= {})[plugin] = 'on'
  } else if (name === 'packages/server') {
    catalog.packages.push({ ...base, name: String(body.name), kind: 'mcp', installed: false, version: null, installing: true, default: project === undefined, settings: {}, servers: [String(body.name)], extras: false, keys: [] })
    if (project !== undefined) (catalog.choices[project] ??= {})[String(body.name)] = 'on'
  } else if (name === 'packages/import' && project !== undefined) {
    for (const server of catalog.imports[project] ?? []) {
      catalog.packages.push({ ...base, name: server, kind: 'mcp', version: null, default: false, settings: {}, servers: [server], extras: false, keys: [] })
      ;(catalog.choices[project] ??= {})[server] = 'on'
    }
    catalog.imports = { ...catalog.imports, [project]: [] }
  } else if (name === 'packages/project' && project !== undefined) {
    const choices = (catalog.choices[project] ??= {})
    if (body.choice === 'on' || body.choice === 'off') choices[String(body.name)] = body.choice
    else delete choices[String(body.name)]
  } else if (name === 'packages/default' && target !== undefined) target.default = body.on === true
  else if (name === 'packages/setting' && target !== undefined) {
    const key = String(body.key)
    const value = typeof body.value === 'string' ? body.value : null
    const values = project === undefined ? target.settings : (((catalog.own[project] ??= {})[target.name] ??= {}))
    if (value === null) delete values[key]
    else values[key] = value
  } else if (name === 'packages/key') catalog.keys[String(body.name)] = true
  else throw new Error(`fake: ${name} is not supported`)
  return { ...state, packages: viewOf(catalog, state.projects) }
}
