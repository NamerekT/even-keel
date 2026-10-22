import { posix, win32 } from 'node:path'

/** `npx` runs a package from its cache, which it may clear: the service needs a folder that stays. */
export function fromNpxCache(root: string): boolean {
  return root.split(/[\\/]/).includes('_npx')
}

/**
 * The `--prefix` of the global npm install holding the package at `root`: `<prefix>/node_modules/<name>` on Windows,
 * `<prefix>/lib/node_modules/<name>` elsewhere. `null` — a local install or the cache of npx, which npm may clear.
 */
export function globalPrefixOf(root: string, platform: NodeJS.Platform): string | null {
  const path = platform === 'win32' ? win32 : posix
  const modules = path.dirname(root)
  if (path.basename(modules) !== 'node_modules' || fromNpxCache(root)) return null
  if (platform === 'win32') return path.dirname(modules)
  const lib = path.dirname(modules)
  return path.basename(lib) === 'lib' ? path.dirname(lib) : null
}
