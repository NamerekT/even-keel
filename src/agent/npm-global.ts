import { homedir } from 'node:os'
import { isRunnable, pathFolders, pathsOf } from '../paths.js'

/** What a binary search reads of the machine, so a test can give another's. */
export interface BinaryMachine {
  platform: NodeJS.Platform
  arch: string
  home: string
  runnable: (path: string) => boolean
}

export const thisMachine = (): BinaryMachine => ({ platform: process.platform, arch: process.arch, home: homedir(), runnable: isRunnable })

/**
 * A CLI npm installs as a wrapper package whose `bin` is a placeholder until its postinstall puts the native binary of
 * a platform package over it (`@anthropic-ai/claude-code`, `opencode-ai`). A newer npm runs no postinstall it was not
 * allowed to, and the platform package is there all the same.
 */
export interface NpmCli {
  wrapper: string
  /** The wrapper's `bin` entry, relative to its folder. */
  bin: string
  /** The platform packages that may hold the native binary, best first, with the binary's path inside each. */
  natives: { pkg: string; file: string }[]
}

/**
 * The folders a global npm install may sit in: on Windows the `node_modules` beside a PATH folder (npm's prefix holds
 * its wrappers) and `%APPDATA%\npm`'s, elsewhere the `lib/node_modules` of a PATH folder's prefix (`<prefix>/bin`).
 */
export function npmGlobalModules(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
  const paths = pathsOf(platform)
  const folders = platform === 'win32'
    ? [...pathFolders(env, platform), ...(env.APPDATA === undefined ? [] : [paths.join(env.APPDATA, 'npm')])].map((folder) => paths.join(folder, 'node_modules'))
    : pathFolders(env, platform).map((folder) => paths.join(paths.dirname(folder), 'lib', 'node_modules'))
  return [...new Set(folders)]
}

/**
 * The binary of a global npm install that runs: the wrapper's `bin` once the postinstall has replaced the placeholder
 * (it took the build that fits the machine), else the platform package's own, inside the wrapper or hoisted beside it.
 */
export function npmCliBinary(cli: NpmCli, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, runnable: (path: string) => boolean = isRunnable): string | undefined {
  const paths = pathsOf(platform)
  const parts = (path: string) => path.split('/')
  const candidates = npmGlobalModules(env, platform).flatMap((modules) => {
    const wrapper = paths.join(modules, ...parts(cli.wrapper))
    return [
      paths.join(wrapper, ...parts(cli.bin)),
      ...cli.natives.map(({ pkg, file }) => paths.join(wrapper, 'node_modules', ...parts(pkg), ...parts(file))),
      ...cli.natives.map(({ pkg, file }) => paths.join(modules, ...parts(pkg), ...parts(file))),
    ]
  })
  return candidates.find(runnable)
}
