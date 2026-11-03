import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/** What the wizard asks of the machine about a typed folder. */
export interface Folders {
  /** The home folder of the user the service runs as. */
  home: string
  isFolder(path: string): boolean
}

export const REAL_FOLDERS: Folders = {
  get home() {
    return homedir()
  },
  isFolder: (folder) => {
    try {
      return statSync(folder).isDirectory()
    } catch {
      return false
    }
  },
}

/** `~` and `~/…` (on Windows also `~\…`) at the start of a path mean the home folder; `~user` and `$HOME` stay as typed. */
export function expandHome(typed: string, home: string, platform: NodeJS.Platform = process.platform): string {
  const rest = /^~(?:[\\/](.*))?$/.exec(typed)
  if (rest === null) return typed
  if (platform !== 'win32' && typed[1] === '\\') return typed
  const flavour = platform === 'win32' ? path.win32 : path.posix
  return rest[1] === undefined || rest[1] === '' ? home : flavour.join(home, rest[1])
}

/** Whether the path is full for the platform the service runs on. */
export function isFullPath(folder: string, platform: NodeJS.Platform = process.platform): boolean {
  return (platform === 'win32' ? path.win32 : path.posix).isAbsolute(folder)
}
