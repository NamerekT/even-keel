import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fail } from '../notice/notice.js'
import type { InstalledServer, ServerEntry } from './model.js'

const run = promisify(execFile)
const NPM_TIMEOUT_MS = 5 * 60_000
const YES = new Set(['-y', '--yes'])

export interface NpxSpec {
  name: string
  range: string
  args: string[]
}

/** `npx -y <package>@<range> …`: the only command whose version Even Keel pins; `null` for any other. */
export function parseNpx(entry: ServerEntry): NpxSpec | null {
  if (typeof entry.command !== 'string' || !/^npx(\.cmd)?$/i.test(entry.command)) return null
  const args = Array.isArray(entry.args) ? entry.args.map(String) : []
  let at = 0
  while (at < args.length && YES.has(args[at]!)) at++
  const spec = args[at]
  if (spec === undefined || spec.startsWith('-')) return null
  const split = spec.lastIndexOf('@')
  const name = split > 0 ? spec.slice(0, split) : spec
  return { name, range: split > 0 ? spec.slice(split + 1) : 'latest', args: args.slice(at + 1) }
}

/** `npm view … version --json` prints one version, or a list of them for a range. */
export function latestOf(output: string): string | null {
  try {
    const value: unknown = JSON.parse(output)
    const last = Array.isArray(value) ? value.at(-1) : value
    return typeof last === 'string' ? last : null
  } catch {
    return null
  }
}

export function binOf(manifest: Record<string, unknown>, name: string): string | null {
  const { bin } = manifest
  if (typeof bin === 'string') return bin
  if (typeof bin !== 'object' || bin === null) return null
  const bins = bin as Record<string, unknown>
  const own = bins[name.split('/').at(-1)!]
  const chosen = typeof own === 'string' ? own : Object.values(bins).find((each) => typeof each === 'string')
  return typeof chosen === 'string' ? chosen : null
}

export function pinnedEntry(entry: ServerEntry, bin: string, args: string[]): ServerEntry {
  return { ...entry, command: 'node', args: [bin, ...args] }
}

/** The version `npm view` gives the spec's range now. */
export async function resolveVersion(spec: NpxSpec): Promise<string> {
  const target = `${spec.name}@${spec.range}`
  try {
    const { stdout } = await npm(['view', target, 'version', '--json'], process.cwd())
    const version = latestOf(stdout)
    if (version === null) throw new Error(`no version in: ${stdout.slice(0, 200)}`)
    return version
  } catch (error) {
    throw fail('packages.npmFailed', { spec: target }, { detail: (error as Error).message }, { cause: error })
  }
}

/** Installs the version into `prefix` and returns the server that runs it with node. */
export async function installPinned(entry: ServerEntry, spec: NpxSpec, version: string, prefix: string): Promise<InstalledServer> {
  const target = `${spec.name}@${version}`
  try {
    // A missing working folder makes spawn report the executable itself as ENOENT.
    mkdirSync(prefix, { recursive: true })
    await npm(['install', '--prefix', prefix, '--no-audit', '--no-fund', '--omit=dev', '--no-save', target], prefix)
  } catch (error) {
    throw fail('packages.npmFailed', { spec: target }, { detail: (error as Error).message }, { cause: error })
  }
  return pinnedServer(entry, spec, version, prefix)
}

/** Copies the same version another install already has in `from` into `prefix`, instead of npm install. */
export async function copyPinned(entry: ServerEntry, spec: NpxSpec, version: string, from: string, prefix: string): Promise<InstalledServer> {
  await cp(from, prefix, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false })
  return pinnedServer(entry, spec, version, prefix)
}

/** The server that runs the bin of the version installed in `prefix` with node. */
export function pinnedServer(entry: ServerEntry, spec: NpxSpec, version: string, prefix: string): InstalledServer {
  const target = `${spec.name}@${version}`
  const home = join(prefix, 'node_modules', ...spec.name.split('/'))
  let manifest: Record<string, unknown> = {}
  try {
    manifest = JSON.parse(readFileSync(join(home, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {}
  const bin = binOf(manifest, spec.name)
  if (bin === null) throw fail('packages.npmFailed', { spec: target }, { detail: 'the package has no bin' })
  return { entry: pinnedEntry(entry, resolve(home, bin), spec.args), npm: { name: spec.name, version } }
}

/** npm through node and its own `npm-cli.js` when found next to node: on Windows `npm.cmd` needs a shell. */
async function npm(args: string[], cwd: string): Promise<{ stdout: string }> {
  const cli = npmCli()
  const options = { cwd, timeout: NPM_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
  if (cli !== undefined) return run(process.execPath, [cli, ...args], options)
  return run('npm', args, { ...options, shell: process.platform === 'win32' })
}

function npmCli(): string | undefined {
  const base = dirname(process.execPath)
  return [join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(base, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find((file) => existsSync(file))
}
