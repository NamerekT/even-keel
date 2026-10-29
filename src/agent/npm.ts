import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { downloadFile, fetchJson, type DownloadProgress } from './download.js'

const run = promisify(execFile)

const REGISTRY = 'https://registry.npmjs.org'
const TARBALL = 'package.tgz'
const UNPACK_TIMEOUT_MS = 5 * 60_000

/** The tarball of a version's registry entry and its sha512 (base64), only from the registry itself. */
export function npmDist(meta: unknown, version: string): { tarball: string; sha512: string } {
  const { version: named, dist } = (meta ?? {}) as { version?: unknown; dist?: { tarball?: unknown; integrity?: unknown } }
  if (named !== version) throw new Error(`the registry entry of ${version} names ${String(named)}`)
  const tarball = dist?.tarball
  if (typeof tarball !== 'string' || !tarball.startsWith(`${REGISTRY}/`)) throw new Error(`${version}: a tarball off the registry: ${String(tarball)}`)
  const integrity = typeof dist?.integrity === 'string' ? /^sha512-(\S+)$/.exec(dist.integrity) : null
  if (integrity === null) throw new Error(`${version}: no sha512 integrity`)
  return { tarball, sha512: integrity[1]! }
}

/** The `latest` dist-tag of a package: the small dist-tags document, not the whole registry entry. */
export async function npmLatest(name: string): Promise<string> {
  const latest = ((await fetchJson(`${REGISTRY}/-/package/${name}/dist-tags`)) as { latest?: unknown } | null)?.latest
  if (typeof latest !== 'string' || !/^\d+\.\d+\.\d+$/.test(latest)) throw new Error(`${name}: no latest version in the registry: ${String(latest)}`)
  return latest
}

/** Downloads `name@version` from the npm registry and unpacks it into `into`, checked against the registry's sha512. */
export async function fetchNpmPackage(name: string, version: string, into: string, progress?: DownloadProgress): Promise<void> {
  const { tarball, sha512 } = npmDist(await fetchJson(`${REGISTRY}/${name}/${version}`), version)
  const file = join(into, TARBALL)
  const got = await downloadFile(tarball, file, 'sha512', progress)
  if (got.base64 !== sha512) throw new Error(`${name}@${version}: sha512 ${got.base64}, the registry says ${sha512}`)
  // A relative archive and the folder as the cwd: GNU tar takes `C:` in a path for a remote host.
  await run(tarBinary(), ['-xzf', TARBALL, '--strip-components=1'], { cwd: into, timeout: UNPACK_TIMEOUT_MS, windowsHide: true })
  await rm(file, { force: true })
}

/** A Linux without glibc (Alpine and the like) takes a package's musl build; Node's report names glibc only where it runs on it. */
export function isMuslLinux(): boolean {
  if (process.platform !== 'linux') return false
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } }
  return report.header?.glibcVersionRuntime === undefined
}

/** Windows' own bsdtar unpacks gzip by itself; another `tar` on the PATH (Git's) may need a `gzip` beside it. */
function tarBinary(): string {
  if (process.platform !== 'win32') return 'tar'
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  return existsSync(system) ? system : 'tar'
}
