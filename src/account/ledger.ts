import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { GLOBAL_ACCOUNT } from './model.js'

export interface AccountRecord {
  email: string | null
  since: string | null
  previous: string | null
}

export interface AccountLedger {
  active: string
  accounts: Record<string, AccountRecord>
}

export function emptyLedger(): AccountLedger {
  return { active: GLOBAL_ACCOUNT, accounts: {} }
}

export function noteAccount(ledger: AccountLedger, key: string, email: string | null, now: Date): AccountLedger | undefined {
  const record = ledger.accounts[key]
  if (email === null || email === record?.email) return undefined
  const noted = { email, since: now.toISOString(), previous: record?.email ?? null }
  return { ...ledger, accounts: { ...ledger.accounts, [key]: noted } }
}

export function accountAt(ledger: AccountLedger, key: string, at: string): string | null {
  const record = ledger.accounts[key]
  if (record === undefined || record.since === null) return null
  return Date.parse(at) >= Date.parse(record.since) ? record.email : record.previous
}

export function activate(ledger: AccountLedger, key: string): AccountLedger {
  return { ...ledger, active: key }
}

export function forgetAccount(ledger: AccountLedger, key: string): AccountLedger {
  const { [key]: _forgotten, ...accounts } = ledger.accounts
  return { ...ledger, accounts }
}

export function parseLedger(raw: unknown): AccountLedger {
  if (!isRecord(raw)) return emptyLedger()
  if (typeof raw.active === 'string' && isRecord(raw.accounts)) {
    const accounts: Record<string, AccountRecord> = {}
    for (const [key, value] of Object.entries(raw.accounts)) if (isRecord(value)) accounts[key] = recordOf(value)
    return { active: raw.active, accounts }
  }
  if ('email' in raw || 'since' in raw) return { active: GLOBAL_ACCOUNT, accounts: { [GLOBAL_ACCOUNT]: recordOf(raw) } }
  return emptyLedger()
}

export function loadLedger(file: string): AccountLedger {
  try {
    return parseLedger(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return emptyLedger()
  }
}

export function saveLedger(file: string, ledger: AccountLedger): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(ledger, null, 2))
}

function recordOf(raw: Record<string, unknown>): AccountRecord {
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  return { email: text(raw.email), since: text(raw.since), previous: text(raw.previous) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
