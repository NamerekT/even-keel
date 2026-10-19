import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { downloadFile, fetchJson } from '../agent/download.js'

const run = promisify(execFile)

const REGISTRY = 'https://registry.npmjs.org'
const PACKAGE = '@openai/codex'
const TARBALL = 'package.tgz'
const UNPACK_TIMEOUT_MS = 5 * 60_000
/** The platforms of the npm package (its `bin/codex.js`): the suffix of the platform's version, the folder of its binary. */
const TRIPLES: Record<string, string> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
}

export interface CodexTarget {
  /** `@openai/codex@<version>-<suffix>` is the platform's package. */
  suffix: string
  triple: string
}

export function codexTarget(platform: NodeJS.Platform, arch: string): CodexTarget | null {
  const suffix = `${platform}-${arch}`
  const triple = TRIPLES[suffix]
  return triple === undefined ? null : { suffix, triple }
}

/** The native binary of the platform's package unpacked into `folder`. */
export function codexBinaryIn(folder: string, target: CodexTarget, platform: NodeJS.Platform = process.platform): string {
  return join(folder, 'vendor', target.triple, 'bin', platform === 'win32' ? 'codex.exe' : 'codex')
}

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

/** Downloads the platform's npm package of `version` (Apache-2.0) and unpacks it into `into`, checked against its sha512. */
export async function fetchCodex(version: string, into: string): Promise<void> {
  const target = codexTarget(process.platform, process.arch)
  if (target === null) throw new Error(`Codex has no build for ${process.platform}-${process.arch}`)
  const full = `${version}-${target.suffix}`
  const { tarball, sha512 } = npmDist(await fetchJson(`${REGISTRY}/${PACKAGE}/${full}`), full)
  const file = join(into, TARBALL)
  const got = await downloadFile(tarball, file, 'sha512')
  if (got.base64 !== sha512) throw new Error(`${PACKAGE}@${full}: sha512 ${got.base64}, the registry says ${sha512}`)
  // A relative archive and the folder as the cwd: GNU tar takes `C:` in a path for a remote host.
  await run(tarBinary(), ['-xzf', TARBALL, '--strip-components=1'], { cwd: into, timeout: UNPACK_TIMEOUT_MS, windowsHide: true })
  await rm(file, { force: true })
  if (!existsSync(codexBinaryIn(into, target))) throw new Error(`${PACKAGE}@${full} has no ${codexBinaryIn('', target)}`)
}

/** Windows' own bsdtar unpacks gzip by itself; another `tar` on the PATH (Git's) may need a `gzip` beside it. */
function tarBinary(): string {
  if (process.platform !== 'win32') return 'tar'
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  return existsSync(system) ? system : 'tar'
}
