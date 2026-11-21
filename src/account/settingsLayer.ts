import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../notice/notice.js'
import type { Queryable } from '../storage/database.js'
import { isCloudVariable } from './cloud.js'
import type { AccountHome } from './homes.js'
import type { SettingsEdit } from './model.js'
import { API_KEY_VARIABLE, mergeSettings, type SettingsPlanner } from './share.js'
import { stripSettingsGuard } from './settingsGuard.js'

type Json = Record<string, unknown>

/**
 * What Even Keel keeps of an account folder's `settings.json` (BTN-901): `written` — what the last transfer wrote there,
 * an edited key keeping its value from before the edit; `own` — the account's own layer, put on top of the global
 * settings at every transfer, `null` removing a key.
 */
export interface SettingsRecord {
  written: Json
  own: Json
}

/** How a person resolved a key changed in the folder: into the global settings, into the account's layer, or lost. */
export type EditChoice = 'share' | 'own' | 'discard'

export const EDIT_CHOICES: readonly EditChoice[] = ['share', 'own', 'discard']

/**
 * Keys the CLI writes into `settings.json` with no one asking for a setting: `claude install` and the update channel's
 * switch. Read in the 2.1.319 binary; the startup migrations of `model` and `env` were seen there too, but a person
 * writes those keys as well, so they stay watched (`docs/unverified/accounts.md`).
 */
const SILENT_KEYS = new Set(['autoUpdatesChannel', 'minimumVersion'])

/** The folder owns these whatever the global settings say (`mergeSettings`), so a change of them is no edit. */
const FOLDER_KEYS = new Set(['apiKeyHelper'])

function isOwnVariable(name: string): boolean {
  return name === API_KEY_VARIABLE || isCloudVariable(name)
}

function sharedEnv(value: unknown): Json {
  return Object.fromEntries(Object.entries(objectOf(value)).filter(([name]) => !isOwnVariable(name)))
}

function ownVariables(value: unknown): Json {
  return Object.fromEntries(Object.entries(objectOf(value)).filter(([name]) => isOwnVariable(name)))
}

function comparable(key: string, value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (key === 'hooks') {
    const hooks = Object.fromEntries(Object.entries(objectOf(value)).filter(([, groups]) => !Array.isArray(groups) || groups.length > 0))
    return Object.keys(hooks).length === 0 ? undefined : JSON.stringify(hooks)
  }
  return JSON.stringify(key === 'env' ? sharedEnv(value) : value)
}

/** The top-level keys of the folder's file whose value moved away from what the last transfer wrote there. */
export function editedKeys(folder: Json, written: Json): string[] {
  folder = stripSettingsGuard(folder)
  written = stripSettingsGuard(written)
  const keys = new Set([...Object.keys(folder), ...Object.keys(written)])
  return [...keys].filter((key) => !SILENT_KEYS.has(key) && !FOLDER_KEYS.has(key) && comparable(key, folder[key]) !== comparable(key, written[key])).sort()
}

/** Longer values are cut: the page shows them in a tip, and a whole `hooks` block would weigh on every state. */
const SHOWN_VALUE = 2000

function shown(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const text = JSON.stringify(value)
  return text.length <= SHOWN_VALUE ? text : `${text.slice(0, SHOWN_VALUE - 1)}…`
}

/** What the page shows of an edited key: its value before and after, or for `env` only the names of what moved. */
export function settingsEdit(key: string, was: unknown, now: unknown): SettingsEdit {
  if (key === 'env') {
    const before = sharedEnv(was)
    const after = sharedEnv(now)
    const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    const differs = (name: string) => JSON.stringify(before[name]) !== JSON.stringify(after[name])
    return { key, variables: {
      added: names.filter((name) => !(name in before)),
      removed: names.filter((name) => !(name in after)),
      changed: names.filter((name) => name in before && name in after && differs(name)),
    } }
  }
  const edit: SettingsEdit = { key }
  const before = shown(was)
  const after = shown(now)
  if (before !== undefined) edit.was = before
  if (after !== undefined) edit.now = after
  return edit
}

export interface SettingsPlan {
  /** What goes into the folder's `settings.json`. */
  file: Json
  /** What to remember as written: the file, with each edited key at its value from before the edit. */
  written: Json
  /** The keys changed in the folder since the last transfer, kept there until a person resolves them. */
  edits: string[]
}

/** The transfer of `settings.json` with the account's layer on top and the folder's own edits kept (`docs/accounts.md`). */
export function planSettings(global: Json, folder: Json | undefined, record: SettingsRecord | undefined, discard: ReadonlySet<string> = new Set()): SettingsPlan {
  const file = mergeSettings(global, folder)
  for (const [key, value] of Object.entries(record?.own ?? {})) {
    if (value === null) delete file[key]
    else file[key] = key === 'env' ? { ...objectOf(value), ...ownVariables(folder?.env) } : value
  }
  const written: Json = { ...file }
  // An edit the transfer would write anyway — made shared, kept as the account's own — is resolved.
  const edits = record === undefined || folder === undefined ? [] : editedKeys(folder, record.written)
    .filter((key) => !discard.has(key) && comparable(key, folder[key]) !== comparable(key, file[key]))
  for (const key of edits) {
    setOrDelete(file, key, folder?.[key])
    setOrDelete(written, key, record?.written[key])
  }
  return { file, written, edits }
}

/**
 * The records of every account folder, held in memory and written behind (`save`): the transfer is synchronous. Reads
 * the folder's file on each `edits`, so the page shows an edit as soon as it is made, not at the next launch.
 */
export class AccountSettings {
  private readonly discards = new Map<string, Set<string>>()
  private readonly seen = new Map<string, { stamp: string; changes: SettingsEdit[] }>()
  private version = 0

  constructor(
    private readonly records: Map<string, SettingsRecord>,
    private readonly globalDir: string,
    private readonly save: (account: string, record: SettingsRecord | null) => void,
  ) {}

  /** The `settings.json` part of `shareConfig` for the folder: remembers what it wrote and uses up a discard. */
  planner(account: string): SettingsPlanner {
    return (global, folder) => {
      const discard = this.discards.get(account) ?? new Set<string>()
      const record = this.records.get(account)
      const plan = planSettings(global, folder, record, discard)
      this.discards.delete(account)
      const next = { written: plan.written, own: record?.own ?? {} }
      if (record === undefined || JSON.stringify(record) !== JSON.stringify(next)) this.keep(account, next)
      return plan.file
    }
  }

  /** The folder edits that would still need a decision at the next transfer. */
  edits(home: AccountHome): string[] {
    return this.changes(home).map((change) => change.key)
  }

  /** `edits` with what each key was and is now. */
  changes(home: AccountHome): SettingsEdit[] {
    const record = this.records.get(home.key)
    if (record === undefined) return []
    const file = join(home.dir, 'settings.json')
    const folderStamp = fileStamp(file)
    if (folderStamp === undefined) return []
    const globalFile = join(this.globalDir, 'settings.json')
    const stamp = `${this.version}:${folderStamp}:${fileStamp(globalFile)}`
    const cached = this.seen.get(home.key)
    if (cached?.stamp === stamp) return cached.changes
    const read = readJson(file)
    const folder = stripSettingsGuard(read ?? {})
    const written = stripSettingsGuard(record.written)
    const changes = read === undefined ? [] : planSettings(
      stripSettingsGuard(readJson(globalFile) ?? {}), folder, record, this.discards.get(home.key),
    ).edits.map((key) => settingsEdit(key, written[key], folder[key]))
    this.seen.set(home.key, { stamp, changes })
    return changes
  }

  /** The keys of the account's own layer. */
  own(account: string): string[] {
    return Object.keys(this.records.get(account)?.own ?? {}).sort()
  }

  /** Every key or none: a key that is no edit any more refuses them all. Takes effect at the next transfer, which the caller starts. */
  resolve(home: AccountHome, keys: string | readonly string[], choice: EditChoice): void {
    const list = typeof keys === 'string' ? [keys] : keys
    const edits = this.edits(home)
    const missing = list.find((key) => !edits.includes(key))
    if (missing !== undefined) throw fail('account.settingsNoEdit', { account: home.key, key: missing })
    for (const key of new Set(list)) this.resolveOne(home, key, choice)
  }

  private resolveOne(home: AccountHome, key: string, choice: EditChoice): void {
    const record = this.records.get(home.key)
    if (record === undefined) throw fail('account.settingsNoEdit', { account: home.key, key })
    const value = stripSettingsGuard(readJson(join(home.dir, 'settings.json')) ?? {})[key]
    if (choice === 'discard') {
      this.discards.set(home.key, new Set([...(this.discards.get(home.key) ?? []), key]))
      this.version++
      return
    }
    if (choice === 'own') {
      this.keep(home.key, { ...record, own: { ...record.own, [key]: value === undefined ? null : key === 'env' ? sharedEnv(value) : value } })
      return
    }
    const file = join(this.globalDir, 'settings.json')
    const global = readJson(file) ?? {}
    setOrDelete(global, key, key === 'env' && value !== undefined ? { ...sharedEnv(value), ...ownVariables(global.env) } : value)
    writeFileSync(file, JSON.stringify(global, null, 2))
    if (Object.hasOwn(record.own, key)) this.dropOwn(home, key)
  }

  /** A key Even Keel itself gives the account (EKR-148); takes effect at the next transfer, which the caller starts. */
  setOwn(home: AccountHome, key: string, value: unknown): void {
    const folder = stripSettingsGuard(readJson(join(home.dir, 'settings.json')) ?? {})
    const record = this.records.get(home.key)
    // A new folder starts at its current file. In a known folder only this key's edit is acknowledged.
    const written = { ...(record?.written ?? folder) }
    setOrDelete(written, key, folder[key])
    this.keep(home.key, { written, own: { ...record?.own, [key]: value } })
  }

  /** Takes effect at the next transfer into the folder, which the caller starts. */
  dropOwn(home: AccountHome, key: string): void {
    const record = this.records.get(home.key)
    if (record === undefined || !(key in record.own)) throw fail('account.settingsNoOwn', { account: home.key, key })
    const { [key]: _, ...own } = record.own
    this.keep(home.key, { ...record, own })
  }

  forget(account: string): void {
    this.discards.delete(account)
    this.seen.delete(account)
    if (!this.records.delete(account)) return
    this.version++
    this.save(account, null)
  }

  private keep(account: string, record: SettingsRecord): void {
    this.records.set(account, record)
    this.version++
    this.save(account, record)
  }
}

/** Table `account_settings` (`docs/storage.md`). */
export async function loadAccountSettings(db: Queryable): Promise<Map<string, SettingsRecord>> {
  const { rows } = await db.query<{ account: string; written: string; own: string }>('select account, written, own from account_settings order by account')
  return new Map(rows.map((row) => [row.account, { written: objectOf(JSON.parse(row.written)), own: objectOf(JSON.parse(row.own)) }]))
}

/** Starts its write at the call: see `Writes`. */
export async function saveAccountSettings(db: Queryable, account: string, record: SettingsRecord | null, at: Date): Promise<void> {
  if (record === null) {
    await db.query('delete from account_settings where account = $1', [account])
    return
  }
  await db.query(
    `insert into account_settings (account, written, own, saved_at) values ($1, $2, $3, $4)
       on conflict (account) do update set written = excluded.written, own = excluded.own, saved_at = excluded.saved_at`,
    [account, JSON.stringify(record.written), JSON.stringify(record.own), at.toISOString()],
  )
}

function setOrDelete(target: Json, key: string, value: unknown): void {
  if (value === undefined) delete target[key]
  else target[key] = value
}

function fileStamp(file: string): string | undefined {
  try {
    const stat = statSync(file)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return undefined
  }
}

function readJson(file: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined
  } catch {
    return undefined
  }
}

function objectOf(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}
