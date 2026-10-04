import { posix, win32 } from 'node:path'

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
