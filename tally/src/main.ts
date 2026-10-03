import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AccountHomes, accountsRoot } from '../../src/account/homes.js'
import { readLaunches } from '../../src/chain/store.js'
import { dbSettings, parseConfig } from './config.js'
import { TallyDb } from './db.js'
import { snapshotsOfFile, snapshotsOfState, type Snapshot } from './limits.js'
import { loadConfig } from '../../src/config.js'
import { loadFile, type Source } from './load.js'
import { launchMap } from './parse.js'
import { ruleSources, skillsOf } from './rule-scan.js'
import { backfillRules, refreshRuleChanges, snapshotRules } from './rule-steps.js'
import { transcriptFiles } from './scan.js'
import { classifySpans, refreshSigns, refreshTasks } from './steps.js'

const CHUNK_BYTES = 8 * 1024 * 1024
const BATON_TIMEOUT_MS = 5_000
const EXIT_GRACE_MS = 10_000

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
try {
  process.loadEnvFile(join(root, '.env'))
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`)

async function run(): Promise<number> {
  const started = Date.now()
  const config = parseConfig(JSON.parse(readFileSync(process.env.TALLY_CONFIG ?? join(root, 'tally', 'tally.config.json'), 'utf8')))
  const stateDir = process.env.BATON_STATE_DIR ?? join(root, 'state')
  const homes = new AccountHomes(process.env, accountsRoot(process.env))
  const launches = launchMap(readLaunches(join(stateDir, 'launches.jsonl')))

  const db = await TallyDb.connect(dbSettings(process.env))
  try {
    if (!(await db.lock())) {
      log('tally: another run holds the lock, skipping')
      return 0
    }
    await db.migrate()
    await db.syncPrices(config.prices)

    const ruleFiles = await ruleSources(homes.list(), batonProjects(), homedir(), log)
    const rules = { home: homedir(), skills: skillsOf(ruleFiles) }
    const contextOf = (source: Source) => ({ account: source.account, launches, rules })
    const sources = await transcriptFiles(homes.list())
    await backfillRules(db, sources, contextOf, CHUNK_BYTES, log)
    const stored = await db.files()
    let files = 0
    let lines = 0
    let failed = 0
    for (const source of sources) {
      try {
        const read = await loadFile(source, stored.get(source.path), db, contextOf(source), CHUNK_BYTES)
        if (read > 0) files++
        lines += read
      } catch (error) {
        failed++
        log(`tally: ${source.path}: ${(error as Error).message}`)
      }
    }
    const forgotten = sources.length > 0 ? await db.forgetFilesExcept(sources.map((source) => source.path)) : 0
    const relabeled = await db.syncLaunches(launches)
    const snapshots = await db.addSnapshots(await limitSnapshots(config.batonUrl, stateDir, homes))
    const versions = await snapshotRules(db, ruleFiles, new Date())
    const changes = await refreshRuleChanges(db)
    const signed = await refreshSigns(db, config.signs)
    const tasks = await refreshTasks(db, log)
    const classified = await classifySpans(db, config.classify, log)
    const unpriced = await db.unpricedModels()
    if (unpriced.length > 0) log(`tally: no price for ${unpriced.join(', ')} — add them to tally.config.json`)

    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    log(
      `tally: ${sources.length} files, ${files} read, ${lines} lines, ${failed} failed, ${forgotten} forgotten, ` +
        `${relabeled} sessions relabeled, ${snapshots} limit snapshots, ` +
        `${ruleFiles.length} rule files (${versions} new versions, ${changes} new changes), ` +
        `${signed.sessions} sessions signed (${signed.spans} spans), ${tasks} Huly tasks, ${classified} spans classified, ${seconds} s`,
    )
    return failed > 0 ? 1 : 0
  } finally {
    await db.close()
  }
}

function batonProjects(): string[] {
  const file = process.env.BATON_CONFIG ?? join(root, 'baton.config.json')
  try {
    return Object.values(loadConfig(file).projects)
  } catch (error) {
    log(`tally: no Baton projects for rule files (${(error as Error).message})`)
    return []
  }
}

async function limitSnapshots(batonUrl: string, stateDir: string, homes: AccountHomes): Promise<Snapshot[]> {
  const url = process.env.BATON_URL ?? batonUrl
  try {
    const response = await fetch(new URL('/api/state', url), { signal: AbortSignal.timeout(BATON_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return snapshotsOfState(await response.json())
  } catch (error) {
    log(`tally: Baton at ${url} gave no limits (${(error as Error).message}), reading rate-limits.json`)
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(join(stateDir, 'rate-limits.json'), 'utf8'))
    return snapshotsOfFile(raw, (dir) => homes.ownerOf(dir))
  } catch {
    return []
  }
}

// process.exit right after a failed fetch trips a libuv assertion on Windows (UV_HANDLE_CLOSING):
// let the loop drain and force the exit only if something still holds it.
const finish = (code: number) => {
  process.exitCode = code
  setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref()
}

run().then(finish, (error: unknown) => {
  log(`tally: ${(error as Error).stack ?? String(error)}`)
  finish(1)
})
