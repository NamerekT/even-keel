import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { reindex } from './git/reindex.js'
import { fileHash, MEMORY_INDEX, memoryFile, parseMemoryFile, type MemoryFact, type MemoryRecord } from './record.js'

/**
 * The records of a memory folder's files, read and written as the memory tools need them (BTN-1646). It stands until
 * BTN-1647 builds the tools over the files themselves: the version of a record is a number drawn from its text's hash,
 * so any change of the file, by a session or a person or a sync, is a new version. Every call is synchronous, so a
 * check of a version and the write after it never let another call in between.
 */

/** A record's version: the first 32 bits of its file's hash, never 0. */
export function textVersion(text: string): number {
  return Number.parseInt(fileHash(text.replace(/\r\n/g, '\n')).slice(0, 8), 16) || 1
}

/** Every record of the folder by name; of two files under one name the first by file name. */
export function folderRecords(folder: string): MemoryRecord[] {
  if (!existsSync(folder)) return []
  const byName = new Map<string, MemoryRecord>()
  for (const file of readdirSync(folder).sort()) {
    const text = recordText(folder, file)
    if (text === null) continue
    const fact = parseMemoryFile(text, file.slice(0, -'.md'.length))
    if (!byName.has(fact.name)) byName.set(fact.name, { ...fact, file, version: textVersion(text) })
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export function folderRecord(folder: string, name: string): MemoryRecord | undefined {
  return folderRecords(folder).find((record) => record.name === name)
}

/** Writes the fact into `file`, or a new file named after it, and gives its line in `MEMORY.md` the description. */
export function writeRecord(folder: string, fact: MemoryFact, file?: string): MemoryRecord {
  mkdirSync(folder, { recursive: true })
  const target = file ?? freeFile(folder, fact.name)
  const text = memoryFile(fact)
  writeFileSync(join(folder, target), text)
  editIndex(folder, target, fact.description)
  return { ...fact, file: target, version: textVersion(text) }
}

export function removeRecord(folder: string, file: string): void {
  try {
    unlinkSync(join(folder, file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  editIndex(folder, file, null)
}

/** `MEMORY.md` with the file's line described anew, `null` — without it; then tidied as a sync tidies it (`reindex`). */
function editIndex(folder: string, file: string, description: string | null): void {
  const path = join(folder, MEMORY_INDEX)
  const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const link = `](${file})`
  const lines = before.replace(/\r\n/g, '\n').split('\n').flatMap((line) => {
    if (!line.includes(link)) return [line]
    if (description === null) return []
    const head = line.slice(0, line.indexOf(link) + link.length)
    return [description === '' ? head : `${head} — ${description}`]
  })
  const facts = new Map<string, MemoryFact>()
  for (const name of readdirSync(folder).sort()) {
    const text = recordText(folder, name)
    if (text !== null) facts.set(name, parseMemoryFile(text, name.slice(0, -'.md'.length)))
  }
  const after = reindex(lines.join('\n'), facts)
  if (after !== before) writeFileSync(path, after)
}

function recordText(folder: string, file: string): string | null {
  if (!file.endsWith('.md') || file === MEMORY_INDEX) return null
  try {
    const path = join(folder, file)
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/** `<name>.md`, or `<name>-2.md` and on when that is taken. */
export function freeFile(folder: string, name: string): string {
  for (let n = 1; ; n++) {
    const file = n === 1 ? `${name}.md` : `${name}-${n}.md`
    if (!existsSync(join(folder, file))) return file
  }
}
