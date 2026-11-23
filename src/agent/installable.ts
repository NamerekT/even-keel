import { accessSync, constants, existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { CLAUDE } from '../claude/name.js'

export interface InstallPlace {
  container: boolean
  env: NodeJS.ProcessEnv
  execPath: string
  platform: NodeJS.Platform
  writable: (path: string) => boolean
}

/**
 * The providers whose CLI a person can install on this machine themselves, as the page's install command says
 * (BTN-1539): none in a container, whose service user writes nothing outside its volumes; elsewhere Claude Code,
 * whose installer writes into the home folder, and the npm ones where npm can write its global folder. The rest are
 * offered Even Keel's copy of the newest release (`cli: latest`).
 */
export function installableClis(providers: readonly string[], place: InstallPlace): string[] {
  if (place.container) return []
  const npm = place.writable(npmGlobalFolder(place.env, place.execPath, place.platform))
  return providers.filter((provider) => provider === CLAUDE || npm)
}

/** Where `npm install -g` puts packages: its configured prefix, else the one of the node it ships with. */
export function npmGlobalFolder(env: NodeJS.ProcessEnv, execPath: string, platform: NodeJS.Platform): string {
  const path = platform === 'win32' ? win32 : posix
  const configured = env.npm_config_prefix || env.NPM_CONFIG_PREFIX
  const prefix = configured || (platform === 'win32' ? path.dirname(execPath) : path.dirname(path.dirname(execPath)))
  return platform === 'win32' ? path.join(prefix, 'node_modules') : path.join(prefix, 'lib', 'node_modules')
}

/** The folder, or the nearest one above it that exists, takes a new entry from this process. */
export function writableFolder(path: string): boolean {
  let current = path
  while (!existsSync(current)) {
    const parent = posix.dirname(current.replaceAll('\\', '/'))
    if (parent === current.replaceAll('\\', '/')) return false
    current = parent
  }
  try {
    accessSync(current, constants.W_OK)
    return true
  } catch {
    return false
  }
}
