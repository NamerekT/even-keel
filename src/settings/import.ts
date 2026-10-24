import { existsSync, renameSync } from 'node:fs'
import { ignoredKeys, parseConfig, readRawConfig, trackerKeysOf, withIds } from '../config.js'
import { fail } from '../notice/notice.js'
import { inTransaction, type Db, type Queryable } from '../storage/database.js'
import { currentConfig } from '../storage/migrations.js'
import { setStateValue, stateValue } from '../storage/service-state.js'
import { IMPORTED_SUFFIX } from '../storage/state-files.js'
import { ADAPTERS } from '../tracker/adapters.js'
import { compareVersions } from '../updates/release.js'
import { fileOf, fileRows, isPlainObject, type FileContents } from './file.js'
import { mirrorDefinitions, readSettings, saveSettings } from './store.js'

export interface ConfigOfFile {
  contents: FileContents
  /** `updates.dismissed` of the file, state since BTN-199; `undefined` — the file has none. */
  dismissed: string | null | undefined
}

/**
 * The config of a file as project records and rows, brought to the current schema, entries without an id given one and
 * checked whole as the service would run it. `updates.dismissed` is taken out: it is state now (`service_state`).
 */
export function configOfFile(raw: unknown): ConfigOfFile {
  let input = currentConfig(raw)
  let dismissed: string | null | undefined
  if (isPlainObject(input) && isPlainObject(input.updates) && Object.hasOwn(input.updates, 'dismissed')) {
    const { dismissed: value, ...updates } = input.updates
    if (value !== null && (typeof value !== 'string' || compareVersions(value, value) === null)) throw fail('config.updatesDismissed', { value: String(JSON.stringify(value)) })
    dismissed = value as string | null
    const { updates: _, ...rest } = input
    input = Object.keys(updates).length === 0 ? rest : { ...rest, updates }
  }
  const filled = withIds(input).raw
  const { trackers } = parseConfig(filled)
  const { records, rows } = fileRows(filled, trackerKeysOf(ADAPTERS))
  // A project's tracker is stored even when the file leaves it to the default, so that no later default moves it (BTN-345).
  const named = new Set(rows.flatMap((row) => (row.key === 'tracker' && row.project !== null ? [row.project] : [])))
  const added = records.filter((record) => !named.has(record.id)).map((record) => ({ key: 'tracker', project: record.id, qualifier: '', value: trackers[record.id] }))
  return { contents: { records, rows: [...rows, ...added] }, dismissed }
}

export interface PrepareSettingsOptions {
  db: Db
  /** `even-keel.config.json`, `EVEN_KEEL_CONFIG`: read once, at the first start of a version with settings in the database. */
  file: string
  log: (line: string) => void
}

/**
 * Mirrors the definitions, then, at the first start with the settings in the database, imports the config file whole in
 * one transaction and renames it to `<file>.imported`; a start without a file starts empty. Later starts never read the
 * file: a file found there is logged, and `config-import` is the way to load one. A file that does not parse stops the
 * start with its notice and stays as it is.
 */
export async function prepareSettings({ db, file, log }: PrepareSettingsOptions): Promise<void> {
  await mirrorDefinitions(db)
  const imported = await stateValue(db, 'config.imported')
  const present = existsSync(file)
  if (imported !== undefined) {
    if (present) log(`config: ${file} is not read, the settings are in the database; npm run storage -- config-import puts a file in their place`)
    return
  }
  const now = new Date().toISOString()
  if (!present) {
    await setStateValue(db, 'config.imported', now)
    return
  }
  const raw = readRawConfig(file)
  const { contents, dismissed } = configOfFile(raw)
  const ignored = ignoredKeys(raw)
  if (ignored.length > 0) log(`config: ${ignored.join(' and ')} in ${file} are not imported; the address comes from EVEN_KEEL_HOST and EVEN_KEEL_PORT`)
  await inTransaction(db, async (tx) => {
    // The switches step 4 moved out of `chain_flags` stay unless the file sets them.
    const placeOf = (row: { key: string; project: string | null; qualifier: string }) => `${row.key}\u0000${row.project ?? ''}\u0000${row.qualifier}`
    const set = new Set(contents.rows.map(placeOf))
    const kept = (await readSettings(tx)).rows.filter((row) => row.project === null && !set.has(placeOf(row)))
    await saveSettings(tx, { records: contents.records, rows: [...contents.rows, ...kept] }, 'import')
    if (dismissed !== undefined) await setStateValue(tx, 'updates.dismissed', dismissed)
    await setStateValue(tx, 'config.imported', now)
  })
  let kept = `the file is kept as ${file}${IMPORTED_SUFFIX}`
  try {
    renameSync(file, `${file}${IMPORTED_SUFFIX}`)
  } catch (error) {
    kept = `the file could not be renamed (${(error as Error).message}) and is not read any more`
  }
  log(`config: moved ${file} into the database: ${contents.records.length} projects, ${contents.rows.length} settings; ${kept}`)
}

/** The settings as a file of the config's format: what `config-export` writes and `config-import` reads back. */
export async function exportConfig(db: Queryable): Promise<string> {
  return `${JSON.stringify(fileOf(await readSettings(db)), null, 2)}\n`
}

/**
 * The file's config in place of the stored one, whole (`config-import`): a key the file lacks goes back to its default,
 * a project it lacks goes. Through the service's port the running service applies it at its next look.
 */
export async function importConfig(db: Queryable, raw: unknown): Promise<FileContents> {
  const { contents, dismissed } = configOfFile(raw)
  await saveSettings(db, contents, 'hand')
  if (dismissed !== undefined) await setStateValue(db, 'updates.dismissed', dismissed)
  return contents
}
