import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface AccountLedger {
  email: string | null
  since: string | null
  previous: string | null
}

export function emptyLedger(): AccountLedger {
  return { email: null, since: null, previous: null }
}

export function noteAccount(ledger: AccountLedger, email: string | null, now: Date): AccountLedger | undefined {
  if (email === null || email === ledger.email) return undefined
  return { email, since: now.toISOString(), previous: ledger.email }
}

export function accountAt(ledger: AccountLedger, at: string): string | null {
  if (ledger.since === null) return null
  return Date.parse(at) >= Date.parse(ledger.since) ? ledger.email : ledger.previous
}

export function loadLedger(file: string): AccountLedger {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AccountLedger>
    const text = (value: unknown) => (typeof value === 'string' ? value : null)
    return { email: text(raw.email), since: text(raw.since), previous: text(raw.previous) }
  } catch {
    return emptyLedger()
  }
}

export function saveLedger(file: string, ledger: AccountLedger): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(ledger, null, 2))
}
