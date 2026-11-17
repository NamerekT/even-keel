import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { onPath } from '../git/setup.js'
import type { ServerOverride } from '../link/view.js'
import type { ServerEntry } from './model.js'

/** A stdio server of a project's packages: what its sessions' gateway starts on the machine they run on (BTN-994). */
export interface StdioServer {
  package: string
  server: string
  command: string
  args: string[]
}

/** The entry's stdio command; `undefined` — a server over HTTP. */
export function stdioOf(name: string, server: string, entry: ServerEntry): StdioServer | undefined {
  if (typeof entry.command !== 'string' || entry.command === '') return undefined
  const args = Array.isArray(entry.args) ? entry.args.filter((arg): arg is string => typeof arg === 'string') : []
  return { package: name, server, command: entry.command, args }
}

/** A server's entry with a machine's own command and arguments in place of the catalog's. */
export function withOverride(entry: ServerEntry, override: ServerOverride | undefined): ServerEntry {
  if (override === undefined || typeof entry.command !== 'string') return entry
  return { ...entry, ...(override.command !== undefined && { command: override.command }), ...(override.args !== undefined && { args: override.args }) }
}

/** Whether the command starts here: a path that exists, or a name on PATH. */
export function commandFound(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return isAbsolute(command) || /[\\/]/.test(command) ? existsSync(command) : onPath(command, env)
}

/** The servers whose command the machine does not have, named `<package>/<server> (<command>)`. */
export function missingCommands(servers: readonly StdioServer[], found: (command: string) => boolean = commandFound): string[] {
  return servers.filter((each) => !found(each.command)).map((each) => `${each.package}/${each.server} (${each.command})`)
}
