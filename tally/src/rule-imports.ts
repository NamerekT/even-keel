import { IMPORT_ACTIONS, IMPORT_PRECISIONS, RULE_PURPOSES, type ImportFile, type RuleImport } from '../../src/stats/rule-imports.js'
import { hashOf } from './rules.js'

export interface ImportRow extends RuleImport {
  hash: string
}

export interface ImportError {
  line: number
  message: string
}

// Every non-empty line is one set; a bad line is reported and skipped, the rest still load.
export function parseImports(text: string): { rows: ImportRow[]; errors: ImportError[] } {
  const rows = new Map<string, ImportRow>()
  const errors: ImportError[] = []
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (line === '') return
    try {
      const hash = hashOf(line)
      rows.set(hash, { hash, ...importOf(JSON.parse(line)) })
    } catch (error) {
      errors.push({ line: index + 1, message: (error as Error).message })
    }
  })
  return { rows: [...rows.values()], errors }
}

function importOf(raw: unknown): RuleImport {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('a line must be a JSON object')
  const record = raw as Record<string, unknown>
  const at = moment(record.at, 'at')
  const until = record.until === undefined || record.until === null ? null : moment(record.until, 'until')
  if (until !== null && until < at) throw new Error('until must not be before at')
  if (!Array.isArray(record.files) || record.files.length === 0) throw new Error('files must be a non-empty list')
  return {
    id: text(record.id, 'id'),
    at,
    until,
    precision: oneOf(record.atPrecision, IMPORT_PRECISIONS, 'atPrecision'),
    sessions: strings(record.sessions, 'sessions'),
    files: record.files.map(fileOf),
    purpose: strings(record.purpose, 'purpose').map((each) => oneOf(each, RULE_PURPOSES, 'purpose')),
    reason: typeof record.reason === 'string' ? record.reason : '',
    task: typeof record.task === 'string' && record.task !== '' ? record.task : null,
    source: typeof record.source === 'string' ? record.source : '',
  }
}

function fileOf(raw: unknown): ImportFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('each file must be an object')
  const record = raw as Record<string, unknown>
  return {
    path: text(record.path, 'files.path'),
    action: oneOf(record.action, IMPORT_ACTIONS, 'files.action'),
    summary: typeof record.summary === 'string' ? record.summary : '',
    precision: record.atPrecision === undefined ? null : oneOf(record.atPrecision, IMPORT_PRECISIONS, 'files.atPrecision'),
    at: record.at === undefined || record.at === null ? null : moment(record.at, 'files.at'),
  }
}

function moment(value: unknown, name: string): string {
  const time = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? Date.parse(value) : Number.NaN
  if (Number.isNaN(time)) throw new Error(`${name} must be an ISO time, got ${JSON.stringify(value)}`)
  return new Date(time).toISOString()
}

function text(value: unknown, name: string): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value) === '') throw new Error(`${name} must be set`)
  return String(value)
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((each) => typeof each !== 'string')) throw new Error(`${name} must be a list of strings`)
  return value as string[]
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (!allowed.includes(value as T)) throw new Error(`${name} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`)
  return value as T
}
