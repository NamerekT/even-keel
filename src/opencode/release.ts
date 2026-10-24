import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fetchNpmPackage, isMuslLinux } from '../agent/npm.js'

/** The platforms `opencode-ai` has a package of its native binary for, by Node's names (`postinstall.mjs` of 1.18.25). */
const PLATFORMS: Record<string, string> = { win32: 'windows', linux: 'linux', darwin: 'darwin' }
const ARCHS = ['x64', 'arm64']

/**
 * The npm package of the platform's binary, which `opencode-ai` lists as an optional dependency; `null` — none. The
 * `-baseline` builds for an x64 without AVX2 are not taken: such a machine runs on the installed CLI (`cli` = `system`).
 */
export function openCodePackage(platform: NodeJS.Platform, arch: string, musl: boolean): string | null {
  const name = PLATFORMS[platform]
  if (name === undefined || !ARCHS.includes(arch)) return null
  return `opencode-${name}-${arch}${platform === 'linux' && musl ? '-musl' : ''}`
}

/** The native binary of the platform's package unpacked into `folder`. */
export function openCodeBinaryIn(folder: string, platform: NodeJS.Platform = process.platform): string {
  return join(folder, 'bin', platform === 'win32' ? 'opencode.exe' : 'opencode')
}

/** Downloads the platform's npm package of `version` (MIT) and unpacks it into `into`, checked against its sha512. */
export async function fetchOpenCode(version: string, into: string): Promise<void> {
  const name = openCodePackage(process.platform, process.arch, isMuslLinux())
  if (name === null) throw new Error(`OpenCode has no build for ${process.platform}-${process.arch}`)
  await fetchNpmPackage(name, version, into)
  if (!existsSync(openCodeBinaryIn(into))) throw new Error(`${name}@${version} has no ${openCodeBinaryIn('')}`)
}
