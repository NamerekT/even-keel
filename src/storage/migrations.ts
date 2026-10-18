import { randomUUID } from 'node:crypto'
import { copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GLOBAL_ACCOUNT } from '../account/model.js'
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
  const chain = readStored(join(stateDir, 'chain.json'))
  const questions = readStored(join(stateDir, 'questions.json'))
  const account = readStored(join(stateDir, 'account.json'))
  const launches = readLaunchLog(join(stateDir, 'launches.jsonl'))
  const packages = readStored(join(stateDir, 'packages.json'))
  const files = [config, chain, questions, account, launches, packages].filter((stored) => stored !== undefined)
  for (const stored of files) refuseNewer(stored.file, stored.version)

  const rewrites: Rewrite[] = []
  const rewrite = (stored: Stored, after: string) => {
    if (after !== stored.text) rewrites.push({ file: stored.file, from: stored.version, before: stored.text, after })
  }

  const active = account !== undefined && account.version < 8 && isRecord(account.value) ? account.value.active : undefined
  let raw: unknown = { projects: [] }
  if (config !== undefined) {
    raw = withIds(currentConfig(config.value, typeof active === 'string' ? active : GLOBAL_ACCOUNT), newId).raw
    rewrite(config, raw === config.value ? config.text : jsonText(raw))
  }
  if (rewrites.length === 0 && files.every((stored) => stored.version === SCHEMA_VERSION)) return
  if (config !== undefined) parseConfig(raw)
  const ids = idsOf(raw)
  const idOf = (file: string) => (project: string) => {
    const id = ids[project]
    if (id === undefined) throw fail('storage.unknownProject', { file, project })
    return id
  }
  if (chain !== undefined && chain.version < 2) rewrite(chain, jsonText(stamped(renameChainProjects(asRecord(chain), idOf(chain.file)))))
  if (questions !== undefined && questions.version < 2) rewrite(questions, jsonText({ version: SCHEMA_VERSION, questions: Array.isArray(questions.value) ? questions.value : [] }))
  if (account !== undefined && account.version < 8) {
    const { active: _moved, ...rest } = asRecord(account)
    rewrite(account, jsonText(stamped(rest)))
  }
  if (launches !== undefined && launches.version < 2) {
    const rename = idOf(launches.file)
    const entries = (launches.value as Record<string, unknown>[]).map((entry) => ({ ...entry, project: rename(String(entry.project)) }))
    rewrite(launches, [{ version: SCHEMA_VERSION }, ...entries].map((line) => `${JSON.stringify(line)}\n`).join(''))
  }
  // v2 → v3: the launch log gains the red commit of a fix's launch and its outcome (BTN-153), optional fields an older
  // reader does without; every file only takes the new version.
  // v3 → v4: the same restamp, for the user's name of an account in `account.json` (`AccountRecord.name`).
  // v4 → v5: the same, for `commands.afterGreen` in the config and the commit they last ran on in the chain's `ci` (BTN-156).
  // v5 → v6: the same, for `agent` and `codexModel` of a project in the config and the Codex sessions of `state/codex/` (BTN-168).
  // v6 → v7: the same, for `codexBypassSandbox` of a project in the config (BTN-171).
  // v7 → v8: the config by `configV8`, the account file without `active`; the other files are restamped, and the launch
  // log gains the optional `fallback` of a launch (BTN-173).
  // v8 → v9: a new file, `state/packages.json` (BTN-174), which the service seeds when it is missing; the others are
  // restamped, `account.json` too.
  for (const stored of [chain, questions, packages]) {
    if (stored !== undefined && stored.version >= 2 && stored.version < SCHEMA_VERSION) rewrite(stored, jsonText(restamped(stored)))
  }
  if (account !== undefined && account.version >= 8 && account.version < SCHEMA_VERSION) rewrite(account, jsonText(restamped(account)))
  if (launches !== undefined && launches.version >= 2 && launches.version < SCHEMA_VERSION) {
    rewrite(launches, launches.text.replace(/^[^\n]*\n?/, `${JSON.stringify({ version: SCHEMA_VERSION })}\n`))
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
  for (const each of rewrites) {
    if (each.from === SCHEMA_VERSION) log(`storage: gave an id to the projects of ${each.file} without one, the previous file is kept at ${copyOf(each)}`)
    else log(`storage: ${each.file} is now v${SCHEMA_VERSION}, the v${each.from} file is kept at ${copyOf(each)}`)
  }
}

/**
 * A config of an older schema brought to the current one, as the start brings the file: also what `config-import`
 * reads. `active` — the active account of an `account.json` older than v8, which v8 moved into the config.
 */
export function currentConfig(raw: unknown, active: string = GLOBAL_ACCOUNT): unknown {
  const version = versionOf(raw)
  const upgraded = version < 2 ? configV2(raw) : version < SCHEMA_VERSION && isRecord(raw) ? stamped(raw) : raw
  return version < 8 ? configV8(upgraded, active) : upgraded
}

/** v1 → v2: the `projects` object by key becomes an array of records in the same order, the key a field of each. */
function configV2(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const { projects } = raw
  if (!isRecord(projects)) return stamped(raw)
  const records = Object.entries(projects).map(([key, entry]) => (isRecord(entry) ? { key, ...entry } : { key, repo: entry }))
  return stamped({ ...raw, projects: records })
}

/**
 * v7 → v8: what a session runs on goes into maps by provider (BTN-173). A project's `agent` becomes its `provider`, its
 * `codexModel` its `models.codex`; the shared `model` becomes `models.claude`; a project's `codexBypassSandbox` becomes
 * the shared `execution.codex`, since the sandbox does not start under the service for any project; the active account
 * of `account.json` becomes the shared `accounts.claude`.
 */
function configV8(raw: unknown, active: string): unknown {
  if (!isRecord(raw)) return raw
  const { model, ...config } = raw
  let bypass = false
  const projects = Array.isArray(config.projects)
    ? config.projects.map((entry: unknown) => {
        if (!isRecord(entry)) return entry
        const { agent, codexModel, codexBypassSandbox, ...rest } = entry
        if (codexBypassSandbox === true) bypass = true
        const models = isRecord(rest.models) ? rest.models : {}
        return {
          ...rest,
          ...(agent === undefined ? {} : { provider: agent }),
          ...(typeof codexModel === 'string' && codexModel.trim() !== '' ? { models: { ...models, codex: codexModel.trim() } } : {}),
        }
      })
    : config.projects
  const merged = (key: string, entry: Record<string, unknown>) => {
    const written = isRecord(config[key]) ? config[key] : {}
    return Object.keys(entry).length === 0 ? {} : { [key]: { ...entry, ...written } }
  }
  return {
    ...config,
    projects,
    ...merged('models', model === undefined ? {} : { claude: model }),
    ...merged('accounts', active === GLOBAL_ACCOUNT ? {} : { claude: active }),
    ...merged('execution', bypass ? { codex: 'bypass' } : {}),
  }
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

function restamped(stored: Stored): Record<string, unknown> {
  return stamped(asRecord(stored))
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
