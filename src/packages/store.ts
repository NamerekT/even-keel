import { readFileSync } from 'node:fs'
import { fail } from '../notice/notice.js'
import { writeAtomic } from '../storage/atomic.js'
import { byMap, inverted, isRecord } from '../storage/projects.js'
import { refuseNewer, SCHEMA_VERSION, versionOf } from '../storage/schema.js'
import type { PackagesFile } from './model.js'

/**
 * `state/packages.json` names a project by its id, the running service by its key; `ids` is the id of each key from
 * the config. `undefined` — no file yet: the catalog is seeded from what sessions get today (`seed.ts`).
 */
export function loadPackages(file: string, ids: Record<string, string> = {}): PackagesFile | undefined {
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
  const rename = byMap(inverted(ids))
  return {
    packages: raw.packages as PackagesFile['packages'],
    projects: renamed(raw.projects, rename) as PackagesFile['projects'],
    pins: renamed(raw.pins, rename) as PackagesFile['pins'],
  }
}

export function savePackages(file: string, packages: PackagesFile, ids: Record<string, string> = {}): void {
  const rename = byMap(ids)
  const stored = { version: SCHEMA_VERSION, packages: packages.packages, projects: renamed(packages.projects, rename), pins: renamed(packages.pins, rename) }
  writeAtomic(file, `${JSON.stringify(stored, null, 2)}\n`)
}

function renamed(records: unknown, rename: (project: string) => string): Record<string, unknown> {
  return isRecord(records) ? Object.fromEntries(Object.entries(records).map(([project, value]) => [rename(project), value])) : {}
}
