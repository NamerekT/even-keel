import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fetchNpmPackage } from '../../agent/npm.js'

const PACKAGE = '@anthropic-ai/claude-agent-sdk'
const MODULE = 'sdk.mjs'

/**
 * The SDK build that goes with a CLI version: the SDK `0.3.N` is released with the CLI `2.1.N` and talks the protocol
 * of that CLI. `null` — no such pair is known, and the session runs on `--bg`.
 */
export function sdkVersionOf(cli: string): string | null {
  const match = /^2\.1\.(\d+)$/.exec(cli.trim())
  return match === null ? null : `0.3.${match[1]}`
}

/** The module of the SDK unpacked into `folder`. */
export function sdkModuleIn(folder: string): string {
  return join(folder, MODULE)
}

/**
 * Downloads the SDK's npm package of `version` into `into`, checked against the registry's sha512. Only the package
 * itself: its optional platform packages carry a CLI of their own (~280 MB), and the session runs on Even Keel's copy.
 */
export async function fetchSdk(version: string, into: string): Promise<void> {
  await fetchNpmPackage(PACKAGE, version, into)
  if (!existsSync(sdkModuleIn(into))) throw new Error(`${PACKAGE}@${version} has no ${MODULE}`)
}
