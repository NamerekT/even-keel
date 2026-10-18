/**
 * Copies of the state database for a move to another machine or a rollback to v0.1 (BTN-147, BTN-198, `docs/storage.md`),
 * and the settings as a file (BTN-199):
 *
 *   npm run storage -- backup <dir>            a copy of the database into a new folder, also while the service runs
 *   npm run storage -- export <dir>            the state as the v0.1 files: chain.json, questions.json, launches.jsonl, handoffs/
 *   npm run storage -- config-export <file>    the settings and projects as a file of the config's format
 *   npm run storage -- config-import <file>    such a file in place of the settings and projects, whole
 *
 * The database is the one of `EVEN_KEEL_STATE_DIR` (`state/` of the checkout by default), through the running service
 * when there is one, which applies an imported file at once. Only `config-import` writes.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readRawConfig } from '../src/config.js'
import { loadEnv, stateDirOf } from '../src/locations.js'
import { englishOf, NoticeError, noticeOf } from '../src/notice/notice.js'
import { exportConfig, importConfig } from '../src/settings/import.js'
import { writeAtomic } from '../src/storage/atomic.js'
import { backupDatabase } from '../src/storage/copy.js'
import { databaseDirOf, readStateDatabase } from '../src/storage/owner.js'
import { exportState, STATE_FILES } from '../src/storage/state-files.js'

const COMMANDS = ['backup', 'export', 'config-export', 'config-import'] as const
const USAGE = `usage: npm run storage -- backup <dir> | export <dir> | config-export <file> | config-import <file>`

async function main(): Promise<void> {
  const [command, target] = process.argv.slice(2) as [(typeof COMMANDS)[number], string | undefined]
  if (!COMMANDS.includes(command) || target === undefined) throw new Error(USAGE)
  loadEnv()
  const dir = databaseDirOf(stateDirOf())
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), target)
  // Read before the database is opened: a file that does not parse changes nothing.
  const raw = command === 'config-import' ? readRawConfig(path) : undefined
  if (command === 'config-export' && existsSync(path)) throw new Error(`storage: ${path} exists; give a new file`)
  if (command === 'export') {
    const taken = Object.values(STATE_FILES).filter((name) => existsSync(join(path, name)))
    if (taken.length > 0) throw new Error(`storage: ${taken.join(', ')} already in ${path}; give an empty folder`)
  }
  const reader = await readStateDatabase(stateDirOf())
  if (reader === undefined) throw new Error(`storage: there is no database in ${dir}; start the service once to make it`)
  try {
    if (command === 'backup') {
      await backupDatabase(reader.db, path)
      console.log(`storage: copied ${dir} to ${path}`)
    } else if (command === 'export') {
      await exportState(reader.db, path)
      console.log(`storage: exported ${dir} to ${path}`)
    } else if (command === 'config-export') {
      writeAtomic(path, await exportConfig(reader.db))
      console.log(`storage: wrote the settings of ${dir} to ${path}`)
    } else {
      const { records, rows } = await importConfig(reader.db, raw)
      console.log(`storage: ${path} is now the settings of ${dir}: ${records.length} projects, ${rows.length} settings; a running service applies them within seconds`)
    }
  } finally {
    await reader.close()
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof NoticeError ? englishOf(noticeOf(error)) : (error as Error).message)
  process.exitCode = 1
}
