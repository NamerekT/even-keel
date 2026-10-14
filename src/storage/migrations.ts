import { randomUUID } from 'node:crypto'
import { copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseConfig, withIds } from '../config.js'
import { fail } from '../notice/notice.js'
import { writeAtomic } from './atomic.js'
import { isRecord, renameChainProjects } from './projects.js'
import { isVersionLine, refuseNewer, SCHEMA_VERSION, versionOf } from './schema.js'

export interface UpgradeOptions {
  configFile: string
  stateDir: string
  log: (line: string) => void
  newId?: () => string
  /** How a new file is written; a test makes it fail midway. */
  write?: (file: string, text: string) => void
}

interface Stored {
  file: string
  text: string
  version: number
  value: unknown
}

interface Rewrite {
  file: string
  from: number
  before: string
  after: string
}

/**
 * Brings the config and the files of `state/` to the current schema version before anything else reads them — all of
 * them or none: a file newer than the code, a broken one or a project of the state the config lacks stops it before
 * the first write. Each rewritten file keeps a copy `<file>.v<N>.bak`. Steps are never removed: an install of any
 * older version gets to the current one step by step.
 */
export function upgradeStorage(options: UpgradeOptions): void {
  const { configFile, stateDir, log, newId = randomUUID, write = writeAtomic } = options
  const config = readStored(configFile)
  if (config === undefined) return
  const chain = readStored(join(stateDir, 'chain.json'))
  const questions = readStored(join(stateDir, 'questions.json'))
  const account = readStored(join(stateDir, 'account.json'))
  const launches = readLaunchLog(join(stateDir, 'launches.jsonl'))
  const files = [config, chain, questions, account, launches].filter((stored) => stored !== undefined)
  for (const stored of files) refuseNewer(stored.file, stored.version)

  const rewrites: Rewrite[] = []
  const rewrite = (stored: Stored, after: string) => {
    if (after !== stored.text) rewrites.push({ file: stored.file, from: stored.version, before: stored.text, after })
  }

  const raw = withIds(config.version < 2 ? configV2(config.value) : config.value, newId).raw
  rewrite(config, raw === config.value ? config.text : jsonText(raw))
  if (rewrites.length === 0 && files.every((stored) => stored.version === SCHEMA_VERSION)) return
  parseConfig(raw)
  const ids = idsOf(raw)
  const idOf = (file: string) => (project: string) => {
    const id = ids[project]
    if (id === undefined) throw fail('storage.unknownProject', { file, project })
    return id
  }
  if (chain !== undefined && chain.version < 2) rewrite(chain, jsonText(stamped(renameChainProjects(asRecord(chain), idOf(chain.file)))))
  if (questions !== undefined && questions.version < 2) rewrite(questions, jsonText({ version: SCHEMA_VERSION, questions: Array.isArray(questions.value) ? questions.value : [] }))
  if (account !== undefined && account.version < 2) rewrite(account, jsonText(stamped(asRecord(account))))
  if (launches !== undefined && launches.version < 2) {
    const rename = idOf(launches.file)
    const entries = (launches.value as Record<string, unknown>[]).map((entry) => ({ ...entry, project: rename(String(entry.project)) }))
    rewrite(launches, [{ version: SCHEMA_VERSION }, ...entries].map((line) => `${JSON.stringify(line)}\n`).join(''))
  }
  if (rewrites.length === 0) return

  for (const each of rewrites) copyFileSync(each.file, copyOf(each))
  const written: Rewrite[] = []
  for (const each of rewrites) {
    try {
      written.push(each)
      write(each.file, each.after)
    } catch (error) {
      for (const done of written) writeAtomic(done.file, done.before)
      throw fail('storage.writeFailed', { file: each.file }, {}, { cause: error })
    }
  }
  for (const each of rewrites) log(`storage: ${each.file} is now v${SCHEMA_VERSION}, the v${each.from} file is kept at ${copyOf(each)}`)
}

/** v1 → v2: the `projects` object by key becomes an array of records in the same order, the key a field of each. */
function configV2(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const { projects } = raw
  if (!isRecord(projects)) return stamped(raw)
  const records = Object.entries(projects).map(([key, entry]) => (isRecord(entry) ? { key, ...entry } : { key, repo: entry }))
  return stamped({ ...raw, projects: records })
}

function idsOf(raw: unknown): Record<string, string> {
  const ids: Record<string, string> = {}
  const projects = isRecord(raw) && Array.isArray(raw.projects) ? raw.projects : []
  for (const entry of projects) if (isRecord(entry) && typeof entry.key === 'string' && typeof entry.id === 'string') ids[entry.key] = entry.id
  return ids
}

/** The record with the current version as its first key. */
function stamped(raw: Record<string, unknown>): Record<string, unknown> {
  const { version: _, ...rest } = raw
  return { version: SCHEMA_VERSION, ...rest }
}

function asRecord(stored: Stored): Record<string, unknown> {
  if (!isRecord(stored.value)) throw fail('storage.damaged', { file: stored.file })
  return stored.value
}

function copyOf(each: Rewrite): string {
  return `${each.file}.v${each.from}.bak`
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function readStored(file: string): Stored | undefined {
  const text = readIfExists(file)
  if (text === undefined) return undefined
  let value: unknown
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    throw fail('storage.damaged', { file })
  }
  return { file, text, version: versionOf(value), value }
}

/** The launches log: v2 opens with the line `{"version":2}`, v1 has no such line. Its value is the entries. */
function readLaunchLog(file: string): Stored | undefined {
  const text = readIfExists(file)
  if (text === undefined) return undefined
  let lines: unknown[]
  try {
    lines = text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as unknown)
  } catch {
    throw fail('storage.damaged', { file })
  }
  const headed = isVersionLine(lines[0])
  return { file, text, version: headed ? versionOf(lines[0]) : 1, value: headed ? lines.slice(1) : lines }
}

function readIfExists(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
