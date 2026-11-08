import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Harness } from '../e2e/service.fixture.js'
import { root } from '../locations.js'

/** What the shared scenarios (`chainOnRealCli`) need of one CLI: its checked copy, its account and its project keys. */
export interface CliKit {
  /** The CLI's name in the scenarios' title. */
  title: string
  /** The adapter left in `AGENTS` (`Harness.realAgents`). */
  agent: string
  /** The kind every session of the scenarios must be (`AgentEntry.kind`), where the adapter has more than one. */
  kind?: string
  /** The checked copy, downloaded once (`checkedCopy`). */
  binary(): Promise<string>
  /** The project's provider, accounts and model on the bench's config, before `start`. */
  configure(run: Harness): void
  /**
   * Points the service at the copy and writes the account folder for the scripted model at `baseURL` (with `/v1`);
   * runs once the bench's environment is set, before the service reads it.
   */
  prepare(run: Harness, binary: string, baseURL: string): void
  /** Stops what the CLI leaves running after a scenario, before the bench's folder is removed. */
  release?(run: Harness, binary: string): void | Promise<void>
}

/**
 * The checked copy of a CLI in `EVEN_KEEL_E2E_CLI_DIR` (`.temp/e2e-cli/` of the checkout by default), under
 * `<name>/<version>/`: fetched once by `fetch` into an empty folder and reused by later runs.
 */
export async function checkedCopy(name: string, version: string, binaryIn: (folder: string) => string, fetch: (folder: string) => Promise<void>): Promise<string> {
  const folder = join(process.env.EVEN_KEEL_E2E_CLI_DIR ?? join(root, '.temp', 'e2e-cli'), name, version)
  const binary = binaryIn(folder)
  if (existsSync(binary)) return binary
  rmSync(folder, { recursive: true, force: true })
  mkdirSync(folder, { recursive: true })
  await fetch(folder)
  return binary
}
