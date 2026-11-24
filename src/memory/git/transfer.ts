import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Queryable } from '../../storage/database.js'
import { setStateValue, stateValue } from '../../storage/service-state.js'
import { MEMORY_INDEX, memoryFile, MIRROR_MARK, parseMemoryFile, type MemoryFact } from '../record.js'
import { reindex } from './reindex.js'
import { ATTRIBUTES } from './sync.js'

/** A live row of `memory_records` (step 54, BTN-1029), as the transfer reads it. */
export interface StoredRecord extends MemoryFact {
  /** The file of the hub's folder the records' mirror last wrote it into; `null` — none. */
  file: string | null
}

export async function storedRecords(db: Queryable, project: string): Promise<StoredRecord[]> {
  const { rows } = await db.query<StoredRecord>(
    'select name, description, type, body, file from memory_records where project_id = $1 and not deleted order by name',
    [project],
  )
  return rows
}

/**
 * The files the records add to the folder (BTN-1646). The folder's own files win, as a hand edit won in the mirror's
 * pull: a record whose name a file there carries is left out, and so is one whose last file holds another record now.
 * `mirrored` — the folder bears the mirror's mark of this project, so a record's file missing from it was removed by a
 * person and stays removed. A record left without a file gets `<name>.md`, or `<name>-2.md` and on when taken.
 */
export function transferPlan(records: readonly StoredRecord[], files: ReadonlyMap<string, MemoryFact>, mirrored: boolean): Map<string, string> {
  const names = new Set([...files.values()].map((fact) => fact.name))
  const plan = new Map<string, string>()
  for (const record of records) {
    if (names.has(record.name)) continue
    if (record.file !== null && (files.has(record.file) || mirrored)) continue
    let file = `${record.name}.md`
    for (let n = 2; files.has(file) || plan.has(file); n++) file = `${record.name}-${n}.md`
    plan.set(file, memoryFile(record))
    names.add(record.name)
  }
  return plan
}

/**
 * The project's records written into its memory folder on the hub once (`memory.transferred`), with `MEMORY.md` and
 * `.gitattributes` as a sync would tidy them, so the folder's first sync puts all of it into the repository in one
 * commit. A start that dies before the mark writes the same files again and skips what is there. Gives the files
 * written.
 */
export async function transferRecords(db: Queryable, project: string, folder: string, log: (line: string) => void): Promise<string[]> {
  const done = ((await stateValue(db, 'memory.transferred')) as string[] | undefined) ?? []
  if (done.includes(project)) return []
  const records = await storedRecords(db, project)
  const files = recordFiles(folder)
  const mark = join(folder, MIRROR_MARK)
  const mirrored = isFile(mark) && readFileSync(mark, 'utf8').trim() === project
  const plan = transferPlan(records, files, mirrored)
  if (plan.size > 0 || files.size > 0) {
    mkdirSync(folder, { recursive: true })
    for (const [file, text] of plan) {
      writeFileSync(join(folder, file), text)
      files.set(file, parseMemoryFile(text, file.slice(0, -'.md'.length)))
    }
    const index = join(folder, MEMORY_INDEX)
    const before = existsSync(index) ? readFileSync(index, 'utf8') : ''
    const after = reindex(before, files)
    if (after !== before) writeFileSync(index, after)
    const attributes = join(folder, '.gitattributes')
    if (!existsSync(attributes)) writeFileSync(attributes, ATTRIBUTES)
  }
  await setStateValue(db, 'memory.transferred', [...new Set([...((await stateValue(db, 'memory.transferred')) as string[] | undefined ?? []), project])])
  log(
    `memory: ${project} ${records.length} records of the state database went into ${folder}: ${plan.size} files written` +
      `${records.length > plan.size ? `, ${records.length - plan.size} kept as the folder has them` : ''}`,
  )
  return [...plan.keys()]
}

function recordFiles(folder: string): Map<string, MemoryFact> {
  const files = new Map<string, MemoryFact>()
  if (!existsSync(folder)) return files
  for (const name of readdirSync(folder).sort()) {
    if (!name.endsWith('.md') || name === MEMORY_INDEX || !isFile(join(folder, name))) continue
    files.set(name, parseMemoryFile(readFileSync(join(folder, name), 'utf8'), name.slice(0, -'.md'.length)))
  }
  return files
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}
