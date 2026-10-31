import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'

const SPAWN_EXTENSIONS = ['.com', '.exe']

export function pathsOf(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

// Windows and macOS file systems ignore case by default, Linux does not.
export function pathKey(path: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = pathsOf(platform).resolve(path)
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return pathKey(a, platform) === pathKey(b, platform)
}

export function isInside(path: string, folder: string, platform: NodeJS.Platform = process.platform): boolean {
  const inner = pathKey(path, platform)
  const outer = pathKey(folder, platform)
  return inner === outer || inner.startsWith(`${outer}${pathsOf(platform).sep}`)
}

/**
 * Whether `spawn` without a shell can start the CLI: a path as it is, a bare name on the PATH — on Windows only with
 * `.com` or `.exe`, the extensions it tries, so a `codex.cmd` or an npm wrapper `codex` alone does not count.
 */
export function findBinary(bin: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync): boolean {
  const paths = pathsOf(platform)
  const windows = platform === 'win32'
  if (bin.includes('/') || (windows && bin.includes('\\'))) return exists(bin)
  const extensions = windows ? SPAWN_EXTENSIONS : ['']
  return pathFolders(env, platform).some((folder) => extensions.some((extension) => exists(paths.join(folder, `${bin}${extension}`))))
}

/** The folders of the PATH, whatever the case of the variable on Windows. */
export function pathFolders(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
  const windows = platform === 'win32'
  const path = Object.entries(env).find(([key]) => (windows ? key.toUpperCase() === 'PATH' : key === 'PATH'))?.[1]
  return (path ?? '').split(pathsOf(platform).delimiter).filter(Boolean)
}
