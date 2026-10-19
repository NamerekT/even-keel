#!/usr/bin/env node
// Read-only SQL against the Tally database, from any folder: the server one as tally_reader, or the local one the
// Even Keel service serves on a loopback port. The read-only transaction is the guard.
// Usage: node <path>/sql.mjs [-n rows] [-w width] [--csv] ("<sql>" | -f file.sql | -) — no SQL argument reads stdin.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const usage = `usage: node sql.mjs [-n rows] [-w width] [--csv] ("<sql>" | -f file.sql | -)
  -n rows   rows printed per result (default 40, 0 = all)
  -w width  cell width cap (default 60, 0 = none)
  --csv     comma-separated output, no caps unless -n/-w given
  no SQL argument or "-" reads SQL from stdin; several statements print several tables`

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const opts = { rows: null, width: null, csv: false, sql: null, file: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = () => (i + 1 < argv.length ? argv[++i] : fail(`${arg} needs a value\n${usage}`))
    if (arg === '-h' || arg === '--help') fail(usage)
    else if (arg === '-n') opts.rows = Number(value())
    else if (arg === '-w') opts.width = Number(value())
    else if (arg === '--csv') opts.csv = true
    else if (arg === '-f') opts.file = value()
    else if (arg === '-') opts.sql = null
    else if (opts.sql === null && opts.file === null) opts.sql = arg
    else fail(`unexpected argument: ${arg}\n${usage}`)
  }
  for (const key of ['rows', 'width']) if (opts[key] !== null && !(opts[key] >= 0)) fail(`bad -${key[0]}\n${usage}`)
  opts.rows ??= opts.csv ? 0 : 40
  opts.width ??= opts.csv ? 0 : 60
  return opts
}

// The script lives in <checkout>/tally/bin; a worktree checkout has neither node_modules nor .env.
function mainCheckout() {
  const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  return checkout.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/, '')
}

function settings(root) {
  let file = {}
  try {
    file = parseEnv(readFileSync(join(root, '.env'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const own = ([key]) => key.startsWith('TALLY_') || key === 'EVEN_KEEL_STATE_DIR'
  const env = { ...file, ...Object.fromEntries(Object.entries(process.env).filter(own)) }
  if (!env.TALLY_DB_HOST) return localSettings(env.EVEN_KEEL_STATE_DIR || join(root, 'state'))
  const missing = ['TALLY_DB_HOST', 'TALLY_DB_NAME', 'TALLY_READER_PASSWORD'].filter((name) => !env[name])
  if (missing.length > 0) fail(`missing in ${join(root, '.env')}: ${missing.join(', ')}`)
  return {
    host: env.TALLY_DB_HOST,
    port: Number(env.TALLY_DB_PORT || 5432),
    database: env.TALLY_DB_NAME,
    user: env.TALLY_READER_USER || 'tally_reader',
    password: env.TALLY_READER_PASSWORD,
    options: '-c default_transaction_read_only=on -c statement_timeout=120000',
    connectionTimeoutMillis: 10_000,
  }
}

// Without TALLY_DB_HOST the database is PGlite, and only the Even Keel service serves it (tally/src/local.ts).
function localSettings(stateDir) {
  const file = join(stateDir, 'tally', 'owner.json')
  let owner
  try {
    owner = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    fail(`no ${file}: the local Tally database is served by the Even Keel service, and it is not running`)
  }
  return { host: '127.0.0.1', port: owner.port, database: 'postgres', user: 'postgres', password: '', connectionTimeoutMillis: 10_000 }
}

async function readSql(opts) {
  if (opts.file !== null) return readFileSync(opts.file, 'utf8')
  if (opts.sql !== null) return opts.sql
  if (process.stdin.isTTY) fail(usage)
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const pad = (n) => String(n).padStart(2, '0')

function cell(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    const d = value
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${time}`
  }
  if (Array.isArray(value)) return value.map(cell).join(',')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).replace(/\r?\n/g, ' ⏎ ')
}

const cap = (text, width) => (width > 0 && text.length > width ? `${text.slice(0, width - 1)}…` : text)
const numeric = (text) => /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(text)

function table(result, opts) {
  if (!result.fields || result.fields.length === 0) return `${result.command ?? 'OK'} ${result.rowCount ?? ''}`.trim()
  const names = result.fields.map((field) => field.name)
  const shown = opts.rows > 0 ? result.rows.slice(0, opts.rows) : result.rows
  const body = shown.map((row) => row.map((value) => cap(cell(value), opts.width)))
  const more = result.rows.length - shown.length
  const tail = more > 0 ? `\n… ${more} more rows (${result.rows.length} total, -n 0 prints all)` : `\n(${result.rows.length} rows)`
  if (opts.csv) {
    const quote = (text) => (/[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text)
    return [names, ...body].map((line) => line.map(quote).join(',')).join('\n') + (more > 0 ? tail : '')
  }
  const widths = names.map((name, i) => Math.max(name.length, ...body.map((line) => line[i].length)))
  const right = names.map((_, i) => body.length > 0 && body.every((line) => line[i] === '' || numeric(line[i])))
  const line = (cells) => cells.map((text, i) => (right[i] ? text.padStart(widths[i]) : text.padEnd(widths[i]))).join(' | ').trimEnd()
  return [line(names), widths.map((w) => '-'.repeat(w)).join('-+-'), ...body.map(line)].join('\n') + tail
}

const opts = parseArgs(process.argv.slice(2))
const sql = (await readSql(opts)).trim()
if (sql === '') fail('empty SQL')
const root = mainCheckout()
const require = createRequire(join(root, 'package.json'))
let pg
try {
  pg = require('pg')
} catch {
  fail(`pg not found in ${join(root, 'node_modules')} — run npm install in the Even Keel checkout`)
}
pg.types.setTypeParser(1700, (text) => text)
pg.types.setTypeParser(20, (text) => text)

const client = new pg.Client(settings(root))
try {
  await client.connect()
  await client.query('begin transaction read only')
  // Rows as arrays: as objects, columns with one name (two `count`s) collapse into the last.
  const results = [await client.query({ text: sql, rowMode: 'array' })].flat()
  process.stdout.write(`${results.map((result) => table(result, opts)).join('\n\n')}\n`)
} catch (error) {
  process.exitCode = 1
  const where = error.position ? ` (at character ${error.position})` : ''
  process.stderr.write(`error: ${error.message}${where}\n`)
} finally {
  await client.query('rollback').catch(() => {})
  await client.end().catch(() => {})
}
