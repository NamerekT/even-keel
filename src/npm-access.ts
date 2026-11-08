// Whether npm may write its global folder on macOS and Linux, and what to tell a user who cannot (BTN-876).
// Node from the nodejs.org installer puts npm's prefix under /usr/local, which belongs to root.
import { accessSync, constants } from 'node:fs'
import { posix } from 'node:path'

/** `path` itself, or its nearest parent that `exists`: npm creates the rest, so that folder's write right decides. */
export function nearestExisting(path: string, exists: (path: string) => boolean): string {
  let folder = path
  while (!exists(folder)) {
    const parent = posix.dirname(folder)
    if (parent === folder) return folder
    folder = parent
  }
  return folder
}

/** `<prefix>/bin` for npm's global `<prefix>/lib/node_modules`, where npm links the commands; `null` — another layout. */
export function globalBinOf(modules: string): string | null {
  const lib = posix.dirname(modules)
  return posix.basename(lib) === 'lib' ? posix.join(posix.dirname(lib), 'bin') : null
}

export function writable(folder: string): boolean {
  try {
    accessSync(folder, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** The startup file of the login shell `$SHELL`; zsh, the default of macOS, when it is neither zsh nor bash. */
export function rcFileOf(shell: string | undefined): string {
  return shell !== undefined && posix.basename(shell) === 'bash' ? '~/.bashrc' : '~/.zshrc'
}

/** What to do when npm cannot write `folder`: move npm's global folder into the home, then run `npx` again. */
export function npmPrefixAdvice(folder: string, shell: string | undefined, npx: string): string {
  const rc = rcFileOf(shell)
  return [
    `npm cannot write its global folder ${folder}: it belongs to another user, usually root when Node came from the nodejs.org installer.`,
    'Move npm\'s global folder into your home and run the install again:',
    '',
    '  mkdir -p ~/.npm-global',
    '  npm config set prefix ~/.npm-global',
    `  echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ${rc}`,
    `  source ${rc}`,
    `  ${npx}`,
    '',
    'Do not run it with sudo: the service would be installed for root, and an update from the page would fail the same way.',
  ].join('\n')
}

/** Refuses root on macOS and Linux: the service, its data and the accounts would belong to root. `null` — go on. */
export function rootRefusal(platform: NodeJS.Platform, uid: number | undefined, npx: string): string | null {
  if (platform === 'win32' || uid !== 0) return null
  return `do not run this as root or with sudo: the service would be installed for root, with its data and accounts in root's home. Run ${npx} as yourself; if npm cannot write its global folder, it says what to do.`
}

export function isAccessError(output: string): boolean {
  return /\bEACCES\b/.test(output)
}
