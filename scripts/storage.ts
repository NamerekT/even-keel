/**
 * Copies of the state database for a move to another machine or a rollback to v0.1 (BTN-147, BTN-198, `docs/storage.md`):
 *
 *   npm run storage -- backup <dir>    a copy of the database into a new folder, also while the service runs
 *   npm run storage -- export <dir>    the state as the v0.1 files: chain.json, questions.json, launches.jsonl, handoffs/
 *
 * The database is the one of `EVEN_KEEL_STATE_DIR` (`state/` of the checkout by default); it is only read, through the
 * running service when there is one.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadEnv, stateDirOf } from '../src/locations.js'
import { backupDatabase } from '../src/storage/copy.js'
import { databaseDirOf, readStateDatabase } from '../src/storage/owner.js'
import { exportState, STATE_FILES } from '../src/storage/state-files.js'

const USAGE = 'usage: npm run storage -- backup <dir> | export <dir>'

async function main(): Promise<void> {
  const [command, target] = process.argv.slice(2)
  if ((command !== 'backup' && command !== 'export') || target === undefined) throw new Error(USAGE)
  loadEnv()
  const dir = databaseDirOf(stateDirOf())
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), target)
  const reader = await readStateDatabase(stateDirOf())
  if (reader === undefined) throw new Error(`storage: there is no database in ${dir}; start the service once to make it`)
  try {
    if (command === 'backup') {
      await backupDatabase(reader.db, path)
    } else {
      const taken = Object.values(STATE_FILES).filter((name) => existsSync(join(path, name)))
      if (taken.length > 0) throw new Error(`storage: ${taken.join(', ')} already in ${path}; give an empty folder`)
      await exportState(reader.db, path)
    }
  } finally {
    await reader.close()
  }
  console.log(`storage: ${command === 'backup' ? 'copied' : 'exported'} ${dir} to ${path}`)
}

try {
  await main()
} catch (error) {
  console.error((error as Error).message)
  process.exitCode = 1
}
