import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fetchNpmPackage, isMuslLinux } from '../agent/npm.js'

const PLATFORMS = ['win32', 'linux', 'darwin']
const ARCHS = ['x64', 'arm64']

/**
 * The npm package of the platform's binary, which `@github/copilot` lists as an optional dependency and its
 * `npm-loader.js` runs (1.0.98); `null` — none. The binary is the whole CLI, Node is not needed.
 */
export function copilotPackage(platform: NodeJS.Platform, arch: string, musl: boolean): string | null {
  if (!PLATFORMS.includes(platform) || !ARCHS.includes(arch)) return null
  return `@github/copilot-${platform === 'linux' && musl ? 'linuxmusl' : platform}-${arch}`
}

/** The native binary of the platform's package unpacked into `folder`. */
export function copilotBinaryIn(folder: string, platform: NodeJS.Platform = process.platform): string {
  return join(folder, platform === 'win32' ? 'copilot.exe' : 'copilot')
}

/**
 * Downloads the platform's npm package of `version` and unpacks it into `into`, checked against its sha512. The binary
 * runs a newer version the CLI updated itself to (`%LOCALAPPDATA%\copilot\pkg` on Windows) unless `COPILOT_AUTO_UPDATE=false`.
 */
export async function fetchCopilot(version: string, into: string): Promise<void> {
  const name = copilotPackage(process.platform, process.arch, isMuslLinux())
  if (name === null) throw new Error(`GitHub Copilot has no build for ${process.platform}-${process.arch}`)
  await fetchNpmPackage(name, version, into)
  if (!existsSync(copilotBinaryIn(into))) throw new Error(`${name}@${version} has no ${copilotBinaryIn('')}`)
}
