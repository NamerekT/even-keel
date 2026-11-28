import { existsSync, type FSWatcher, watch } from 'node:fs'

/**
 * `fs.watch` of a folder that tells the changed name and closes itself on an error. On Windows nothing errs once the
 * watched folder is removed: the watcher fires change events without end, ~10^5 a second, so an event of no folder
 * closes it too (BTN-1822).
 */
export function watchWhileThere(folder: string, options: { recursive?: boolean }, changed: (name: string | null) => void): FSWatcher {
  const watcher = watch(folder, options, (_event, name) => {
    if (existsSync(folder)) changed(name)
    else watcher.close()
  })
  watcher.on('error', () => watcher.close())
  return watcher
}
