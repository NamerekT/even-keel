import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadFile, fetchJson } from '../agent/download.js'

/** Anthropic publishes every build here, with a `manifest.json` of sizes and sha256 per platform (`docs/sessions.md`). */
const RELEASES = 'https://downloads.claude.ai/claude-code-releases'
const ARCHES = ['x64', 'arm64']
const BINARY = /^claude(\.exe)?$/
const SHA256 = /^[0-9a-f]{64}$/

export interface ManifestEntry {
  binary: string
  checksum: string
  size: number
}

/** The platform key of the manifest: `win32-x64`, `linux-arm64-musl`; `null` — Claude Code has no build for the machine. */
export function claudePlatform(platform: NodeJS.Platform, arch: string, musl: boolean): string | null {
  if (!ARCHES.includes(arch) || !['win32', 'darwin', 'linux'].includes(platform)) return null
  return `${platform}-${arch}${platform === 'linux' && musl ? '-musl' : ''}`
}

export function manifestEntry(manifest: unknown, version: string, platform: string): ManifestEntry {
  const { version: named, platforms } = (manifest ?? {}) as { version?: unknown; platforms?: Record<string, unknown> }
  if (named !== version) throw new Error(`the manifest of ${version} names ${String(named)}`)
  const entry = platforms?.[platform] as Partial<ManifestEntry> | undefined
  if (entry === undefined) throw new Error(`the manifest of ${version} has no build for ${platform}`)
  const { binary, checksum, size } = entry
  if (typeof binary !== 'string' || !BINARY.test(binary) || typeof checksum !== 'string' || !SHA256.test(checksum) || typeof size !== 'number') {
    throw new Error(`the manifest of ${version} has a strange entry for ${platform}`)
  }
  return { binary, checksum, size }
}

/** The version in `claude daemon status`; `null` — no daemon runs ("not running"). */
export function daemonVersionOf(status: string): string | null {
  return /^version:\s*(\S+)/m.exec(status)?.[1] ?? null
}

/** `claude daemon status` says no daemon runs: 2.1.308 opens its stdout with "not running" and exits with code 1. */
export function noDaemonIn(status: string): boolean {
  return /^\s*(?:daemon:\s*)?not running\s*?(?:\n|$)/.test(status)
}

/** The binary's name in the version's folder. */
export function claudeBinaryIn(folder: string): string {
  return join(folder, process.platform === 'win32' ? 'claude.exe' : 'claude')
}

/** Downloads `version` for this machine into `into`, checked against the manifest's size and sha256. */
export async function fetchClaude(version: string, into: string, progress?: import('../agent/download.js').DownloadProgress): Promise<void> {
  const platform = claudePlatform(process.platform, process.arch, isMusl())
  if (platform === null) throw new Error(`Claude Code has no build for ${process.platform}-${process.arch}`)
  const { binary, checksum, size } = manifestEntry(await fetchJson(`${RELEASES}/${version}/manifest.json`), version, platform)
  const file = join(into, binary)
  const got = await downloadFile(`${RELEASES}/${version}/${platform}/${binary}`, file, 'sha256', progress, size)
  if (got.bytes !== size || got.hex !== checksum) throw new Error(`${binary} of ${version}: ${got.bytes} bytes, sha256 ${got.hex}; the manifest says ${size}, ${checksum}`)
  if (process.platform !== 'win32') await chmod(file, 0o755)
}

/** A Linux without glibc (Alpine): Node's report names no glibc there. */
function isMusl(): boolean {
  if (process.platform !== 'linux') return false
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header
  return header?.glibcVersionRuntime === undefined
}
