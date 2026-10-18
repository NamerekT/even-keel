/**
 * Copies of the state database for a move to another machine or a rollback to v0.1 (BTN-147, `docs/storage.md`):
 *
 *   npm run storage -- backup <file>   a consistent copy of the database, also while the service runs
 *   npm run storage -- export <dir>    the state as the v0.1 files: chain.json, questions.json, launches.jsonl, handoffs/
 *
 * The database is the one of `EVEN_KEEL_STATE_DIR` (`state/` of the checkout by default); it is only read.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadEnv, stateDirOf } from '../src/locations.js'
import { DATABASE_FILE, readDatabase } from '../src/storage/database.js'
import { backupDatabase, exportState, STATE_FILES } from '../src/storage/state-files.js'

const USAGE = 'usage: npm run storage -- backup <file> | export <dir>'

function main(): void {
  const [command, target] = process.argv.slice(2)
  if ((command !== 'backup' && command !== 'export') || target === undefined) throw new Error(USAGE)
  loadEnv()
  const file = join(stateDirOf(), DATABASE_FILE)
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), target)
  const db = readDatabase(file)
  if (db === undefined) throw new Error(`storage: there is no ${file}; start the service once to make it`)
  try {
    if (command === 'backup') {
      backupDatabase(db, path)
    } else {
      const taken = Object.values(STATE_FILES).filter((name) => existsSync(join(path, name)))
      if (taken.length > 0) throw new Error(`storage: ${taken.join(', ')} already in ${path}; give an empty folder`)
      exportState(db, path)
    }
  } finally {
    db.close()
  }
  console.log(`storage: ${command === 'backup' ? 'copied' : 'exported'} ${file} to ${path}`)
}

try {
  main()
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}
