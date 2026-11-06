import { chmodSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const RENAME_RETRY_MS = 3000
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

/**
 * Writes the file whole or not at all: into a temporary file next to it, then a rename over it.
 * In-process readers must use synchronous fs calls: a pending async close cannot run during rename's retry wait.
 * Off Windows the file keeps the permissions of the one it replaces, so a 600 account file does not turn 644 under the
 * umask (EKR-95); `mode` sets them instead, for a file that must stay private whether it is new or not.
 */
export function writeAtomic(file: string, text: string, mode?: number): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  try {
    const kept = process.platform === 'win32' ? undefined : mode ?? modeOf(file)
    // Owner-only until the chmod, so a private file's text is never readable by others on the way.
    writeFileSync(temp, text, kept === undefined ? {} : { mode: 0o600 })
    if (kept !== undefined) chmodSync(temp, kept)
    renameOver(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

function modeOf(file: string): number | undefined {
  try {
    return statSync(file).mode & 0o7777
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * A rename retried for up to three seconds on Windows: readers there (virus scanners, the indexer) can briefly deny
 * replacing a file they have open or moving a folder just closed (BTN-674).
 */
export function renameOver(temp: string, file: string): void {
  const deadline = Date.now() + RENAME_RETRY_MS
  let pause = 10
  for (;;) {
    try {
      renameSync(temp, file)
      return
    } catch (error) {
      const remaining = deadline - Date.now()
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || remaining <= 0) throw error
      Atomics.wait(waitBuffer, 0, 0, Math.min(pause, remaining))
      pause = Math.min(pause + 10, 100)
    }
  }
}
