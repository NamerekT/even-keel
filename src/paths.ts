import { existsSync, realpathSync } from 'node:fs'
import { posix, win32 } from 'node:path'

const SPAWN_EXTENSIONS = ['.com', '.exe']

export function pathsOf(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

/**
 * A key that is one for every spelling of a folder. Git answers with real paths, links resolved (macOS `/var` is
 * `/private/var`), so on this machine's own platform the key is the real path too; a part not created yet is kept as
 * it is under its nearest real parent. Windows and macOS file systems ignore case by default, Linux does not.
 */
export function pathKey(path: string, platform: NodeJS.Platform = process.platform): string {
  return foldCase(realOf(path, platform), platform)
}

function foldCase(path: string, platform: NodeJS.Platform): string {
  return platform === 'win32' || platform === 'darwin' ? path.toLowerCase() : path
}

function realOf(path: string, platform: NodeJS.Platform): string {
  const paths = pathsOf(platform)
  const resolved = paths.resolve(path)
  if (platform !== process.platform) return resolved
  const missing: string[] = []
  for (let current = resolved; ; ) {
    try {
      return paths.join(realpathSync.native(current), ...missing)
    } catch {
      const parent = paths.dirname(current)
      if (parent === current) return resolved
      missing.unshift(paths.basename(current))
      current = parent
    }
  }
}

/**
 * `path` spelled under `folder` when it lies inside it, links or not: a path git gave back, put the way the project
 * names its folder. A path outside the folder is kept as it is.
 */
export function spelledUnder(path: string, folder: string, platform: NodeJS.Platform = process.platform): string {
  const paths = pathsOf(platform)
  const inner = realOf(path, platform)
  const outer = realOf(folder, platform)
  const innerKey = foldCase(inner, platform)
  const outerKey = foldCase(outer, platform)
  if (innerKey === outerKey) return paths.resolve(folder)
  if (!innerKey.startsWith(`${outerKey}${paths.sep}`)) return path
  return paths.join(paths.resolve(folder), inner.slice(outer.length + 1))
}

/**
 * `path` relative to `folder` with forward slashes on any platform, when it lies strictly inside it, links and case of
 * the drive letter aside; `null` — the folder itself or a path outside it.
 */
export function relativeUnder(path: string, folder: string, platform: NodeJS.Platform = process.platform): string | null {
  const paths = pathsOf(platform)
  const inner = realOf(path, platform)
  const outer = realOf(folder, platform)
  if (!foldCase(inner, platform).startsWith(`${foldCase(outer, platform)}${paths.sep}`)) return null
  return inner.slice(outer.length + 1).split(paths.sep).join('/')
}

/**
 * `relativeUnder` by the paths as they are written, links not followed: for a path a person reads, where a link out of
 * the folder is still named by its place in it. `null` — the folder itself or a path not written under it.
 */
export function writtenUnder(path: string, folder: string, platform: NodeJS.Platform = process.platform): string | null {
  const paths = pathsOf(platform)
  const inner = paths.resolve(path)
  const outer = paths.resolve(folder)
  if (!foldCase(inner, platform).startsWith(`${foldCase(outer, platform)}${paths.sep}`)) return null
  return inner.slice(outer.length + 1).split(paths.sep).join('/')
}

/**
 * A path as a notice names it (BTN-1150): written from `folder` when it lies under it (`writtenUnder`), with the whole
 * one as `full` for the tip and the log; as it is otherwise.
 */
export function shownUnder(path: string, folder: string, platform: NodeJS.Platform = process.platform): { path: string; full?: string } {
  const short = writtenUnder(path, folder, platform)
  return short === null ? { path } : { path: short, full: path }
}

export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return pathKey(a, platform) === pathKey(b, platform)
}

/**
 * The folder as a CLI started in it sees its working folder: the real path, links resolved — a symlink off Windows
 * (macOS `/tmp` is `/private/tmp`, EKR-94) and a junction on Windows (EKR-96). A folder that cannot be resolved is kept
 * as it is, and so is a Windows one whose real path leaves its drive (a `subst` or mapped drive, a `\\?\` or UNC path):
 * what the CLI reads there is unchecked.
 */
export function workingFolder(folder: string, platform: NodeJS.Platform = process.platform, real: (path: string) => string = realpathSync.native): string {
  let resolved: string
  try { resolved = real(folder) } catch { return folder }
  if (platform !== 'win32') return resolved
  const sameDrive = !resolved.startsWith('\\\\') && win32.parse(resolved).root.toLowerCase() === win32.parse(win32.resolve(folder)).root.toLowerCase()
  return sameDrive ? resolved : folder
}

/** The same path as written, links not followed: where a link points, not where it leads. */
export function sameSpelling(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const paths = pathsOf(platform)
  return foldCase(paths.resolve(a), platform) === foldCase(paths.resolve(b), platform)
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

/** The executable spawn resolves, made absolute so a recovery terminal need not share the service's PATH. */
export function binaryPath(bin: string, env: NodeJS.ProcessEnv, cwd: string, platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync): string | undefined {
  const paths = pathsOf(platform)
  if (bin.includes('/') || (platform === 'win32' && bin.includes('\\'))) return paths.resolve(cwd, bin)
  const extensions = platform === 'win32' && paths.extname(bin) === '' ? SPAWN_EXTENSIONS : ['']
  const folders = platform === 'win32' ? [cwd, ...pathFolders(env, platform)] : pathFolders(env, platform)
  for (const folder of folders) {
    for (const extension of extensions) {
      const file = paths.resolve(cwd, folder, `${bin}${extension}`)
      if (exists(file)) return file
    }
  }
  return undefined
}

/** The folders of the PATH, whatever the case of the variable on Windows. */
export function pathFolders(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
  const windows = platform === 'win32'
  const path = Object.entries(env).find(([key]) => (windows ? key.toUpperCase() === 'PATH' : key === 'PATH'))?.[1]
  return (path ?? '').split(pathsOf(platform).delimiter).filter(Boolean)
}
