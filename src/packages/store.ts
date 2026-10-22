import { readFileSync } from 'node:fs'
import { fail } from '../notice/notice.js'
import { writeAtomic } from '../storage/atomic.js'
import { isRecord } from '../storage/projects.js'
import { refuseNewer, SCHEMA_VERSION, versionOf } from '../storage/schema.js'
import type { PackagesFile } from './model.js'

/**
 * `state/packages.json` names a project by its id, as the service does (BTN-271). `undefined` — no file yet: the
 * catalog is seeded from what sessions get today (`seed.ts`).
 */
export function loadPackages(file: string): PackagesFile | undefined {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw fail('storage.damaged', { file })
  }
  refuseNewer(file, versionOf(raw))
  if (!isRecord(raw) || !isRecord(raw.packages)) throw fail('storage.damaged', { file })
  return {
    packages: raw.packages as PackagesFile['packages'],
    projects: (isRecord(raw.projects) ? raw.projects : {}) as PackagesFile['projects'],
    pins: (isRecord(raw.pins) ? raw.pins : {}) as PackagesFile['pins'],
  }
}

export function savePackages(file: string, packages: PackagesFile): void {
  const stored = { version: SCHEMA_VERSION, packages: packages.packages, projects: packages.projects, pins: packages.pins }
  writeAtomic(file, `${JSON.stringify(stored, null, 2)}\n`)
}
