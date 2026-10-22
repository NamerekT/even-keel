import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fetchNpmPackage } from '../agent/npm.js'

const PACKAGE = '@openai/codex'
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

/** Downloads the platform's npm package of `version` (Apache-2.0) and unpacks it into `into`, checked against its sha512. */
export async function fetchCodex(version: string, into: string): Promise<void> {
  const target = codexTarget(process.platform, process.arch)
  if (target === null) throw new Error(`Codex has no build for ${process.platform}-${process.arch}`)
  const full = `${version}-${target.suffix}`
  await fetchNpmPackage(PACKAGE, full, into)
  if (!existsSync(codexBinaryIn(into, target))) throw new Error(`${PACKAGE}@${full} has no ${codexBinaryIn('', target)}`)
}
