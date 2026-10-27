import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const RENAME_RETRY_MS = 3000
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

/**
 * Writes the file whole or not at all: into a temporary file next to it, then a rename over it.
 * In-process readers must use synchronous fs calls: a pending async close cannot run during rename's retry wait.
 */
export function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(temp, text)
    renameOver(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/** Windows readers (including virus scanners) can briefly deny replacing a file they have open. */
function renameOver(temp: string, file: string): void {
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
