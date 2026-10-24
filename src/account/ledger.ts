import { readFileSync } from 'node:fs'
import { writeAtomic } from '../storage/atomic.js'
import { refuseNewer, SCHEMA_VERSION, versionOf } from '../storage/schema.js'
import { GLOBAL_ACCOUNT } from './model.js'
import { isTransport, type Transport } from './transport.js'

export interface AccountRecord {
  email: string | null
  since: string | null
  previous: string | null
  /** The name the user gave the account; the page shows it instead of the folder key (schema v4). */
  name?: string
}

/** The accounts seen in each folder; the active one is the config's `accounts.claude` since schema v8. */
export interface AccountLedger {
  accounts: Record<string, AccountRecord>
  removing: string[]
  /**
   * The transports the accounts had until schema v12 (BTN-353), waiting for the service's start to become
   * `execution.claude` (`executionOfChoices`); it drops them then.
   */
  transports?: Record<string, Transport>
}

export function emptyLedger(): AccountLedger {
  return { accounts: {}, removing: [] }
}

export function noteAccount(ledger: AccountLedger, key: string, email: string | null, now: Date): AccountLedger | undefined {
  const record = ledger.accounts[key]
  if (email === null || email === record?.email) return undefined
  const noted = { ...record, email, since: now.toISOString(), previous: record?.email ?? null }
  return { ...ledger, accounts: { ...ledger.accounts, [key]: noted } }
}

export function nameAccount(ledger: AccountLedger, key: string, name: string): AccountLedger {
  const { name: _old, ...record } = ledger.accounts[key] ?? { email: null, since: null, previous: null }
  const named = name.trim() === '' ? record : { ...record, name: name.trim() }
  return { ...ledger, accounts: { ...ledger.accounts, [key]: named } }
}

export function accountAt(ledger: AccountLedger, key: string, at: string): string | null {
  const record = ledger.accounts[key]
  if (record === undefined || record.since === null) return null
  return Date.parse(at) >= Date.parse(record.since) ? record.email : record.previous
}

export function forgetAccount(ledger: AccountLedger, key: string): AccountLedger {
  const { [key]: _forgotten, ...accounts } = ledger.accounts
  return { ...ledger, accounts, removing: ledger.removing.filter((each) => each !== key) }
}

export function markRemoving(ledger: AccountLedger, key: string, on: boolean): AccountLedger {
  const removing = ledger.removing.filter((each) => each !== key)
  return { ...ledger, removing: on ? [...removing, key] : removing }
}

export function parseLedger(raw: unknown): AccountLedger {
  if (!isRecord(raw)) return emptyLedger()
  if (isRecord(raw.accounts)) {
    const accounts: Record<string, AccountRecord> = {}
    for (const [key, value] of Object.entries(raw.accounts)) if (isRecord(value)) accounts[key] = recordOf(value)
    const removing = Array.isArray(raw.removing) ? raw.removing.filter((key): key is string => typeof key === 'string') : []
    if (!isRecord(raw.transports)) return { accounts, removing }
    const transports = Object.fromEntries(Object.entries(raw.transports).filter((entry): entry is [string, Transport] => isTransport(entry[1])))
    return { accounts, removing, transports }
  }
  if ('email' in raw || 'since' in raw) return { accounts: { [GLOBAL_ACCOUNT]: recordOf(raw) }, removing: [] }
  return emptyLedger()
}

export function loadLedger(file: string): AccountLedger {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return emptyLedger()
  }
  refuseNewer(file, versionOf(raw))
  return parseLedger(raw)
}

export function saveLedger(file: string, ledger: AccountLedger): void {
  writeAtomic(file, JSON.stringify({ version: SCHEMA_VERSION, ...ledger }, null, 2))
}

function recordOf(raw: Record<string, unknown>): AccountRecord {
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  const record: AccountRecord = { email: text(raw.email), since: text(raw.since), previous: text(raw.previous) }
  return { ...record, ...(typeof raw.name === 'string' && { name: raw.name }) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
