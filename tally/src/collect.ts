import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { AccountHomes, accountsRoot } from '../../src/account/homes.js'
import { readLaunches } from '../../src/chain/store.js'
import { loadConfig } from '../../src/config.js'
import { HALTED } from '../../src/stats/tally-schema.js'
import { parseConfig, type DbSettings } from './config.js'
import { TallyDb } from './db.js'
import { refreshHandoffs } from './handoffs.js'
import { snapshotsOfFile, snapshotsOfState, type Snapshot } from './limits.js'
import { loadFile, type Source } from './load.js'
import { deniedLine } from './migrations.js'
import { launchMap } from './parse.js'
import { transcriptSession } from './rule-history.js'
import { readBackup, ruleSources, skillsOf } from './rule-scan.js'
import { backfillRules, collectRuleHistory, importRuleHistory, refreshRuleChanges, snapshotRules } from './rule-steps.js'
import { transcriptFiles } from './scan.js'
import { classifySpans, refreshSigns, refreshSteps, refreshTasks, refreshTurns, reportTaskTimes } from './steps.js'

const CHUNK_BYTES = 8 * 1024 * 1024
const EVEN_KEEL_TIMEOUT_MS = 5_000

export type Log = (message: string) => void

// One collector run: the exit code is 1 when a file failed to load, everything else is written anyway.
export async function collect(settings: DbSettings, root: string, log: Log): Promise<number> {
  const started = Date.now()
  const config = parseConfig(JSON.parse(readFileSync(process.env.TALLY_CONFIG ?? join(root, 'tally', 'tally.config.json'), 'utf8')))
  const stateDir = process.env.EVEN_KEEL_STATE_DIR ?? join(root, 'state')
  const homes = new AccountHomes(process.env, accountsRoot(process.env))
  const journal = readLaunches(join(stateDir, 'launches.jsonl'))
  const launches = launchMap(journal)

  const db = await TallyDb.connect(settings)
  try {
    if (!(await db.lock())) {
      log('tally: another run holds the lock, skipping')
      return 0
    }
    const migration = await db.migrate()
    if (migration.state === 'newer') {
      log(`tally: the database is at schema v${migration.version}, this Even Keel knows up to v${migration.known}: nothing is collected until it is updated`)
      return HALTED
    }
    if (migration.state === 'denied') {
      log(deniedLine(migration))
      return HALTED
    }
    if (migration.state === 'migrated') log(`tally: database schema ${migration.from === 0 ? 'unversioned' : `v${migration.from}`} → v${migration.to}`)
    await db.syncPrices(config.prices)

    const projects = trackedProjects(root, log)
    const ruleScan = await ruleSources(homes.list(), projects, homedir(), log)
    const ruleFiles = ruleScan.sources
    const rules = { home: homedir(), skills: skillsOf(ruleFiles) }
    const accountDirs = new Map(homes.list().map((home) => [home.key, home.dir]))
    const contextOf = (source: Source) => {
      const session = transcriptSession(source.path)
      const dir = join(accountDirs.get(source.account) ?? homes.global.dir, 'file-history', session)
      return { account: source.account, launches, rules: { ...rules, history: { session, dir, read: readBackup } } }
    }
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
    await db.fillSessionFolders()
    if ((await db.meta('efforts')) === null) {
      log(`tally: ${await db.fillEfforts()} older messages given their effort level`)
      await db.setMeta('efforts', new Date().toISOString())
    }
    const prompted = await db.fillPrompts()
    const handoffs = await refreshHandoffs(db, stateDir, sources, journal)
    const snapshots = await db.addSnapshots(await limitSnapshots(config.evenKeelUrl, stateDir, homes, log))
    const versions = await snapshotRules(db, ruleScan, new Date())
    const history = await collectRuleHistory(db, homes.list(), projects, homedir(), log)
    const changes = await refreshRuleChanges(db)
    const imported = await importRuleHistory(db, resolve(root, config.ruleHistory ?? join(stateDir, 'rule-history.jsonl')), log)
    const signed = await refreshSigns(db, config.signs)
    const turned = await refreshTurns(db)
    const stepped = await refreshSteps(db, config.steps)
    const tasks = await refreshTasks(db, log)
    const reports = await reportTaskTimes(db, config.reportsSince, log)
    const classified = await classifySpans(db, config.classify, log)
    const unpriced = await db.unpricedModels()
    if (unpriced.length > 0) log(`tally: no price for ${unpriced.join(', ')} — add them to tally.config.json`)

    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    log(
      `tally: ${sources.length} files, ${files} read, ${lines} lines, ${failed} failed, ${forgotten} forgotten, ` +
        `${relabeled} sessions relabeled, ${prompted} prompts, ${handoffs} handoffs, ${snapshots} limit snapshots,` +
        `${ruleFiles.length} rule files (${versions} new versions, ${history} from git, ${changes} new changes), ${imported} imported rule sets, ` +
        `${signed.sessions} sessions signed (${signed.spans} spans), ${turned} sessions split into turns, ${stepped} into steps, ${tasks} Huly tasks, ${reports} time reports, ${classified} spans classified, ${seconds} s`,
    )
    return failed > 0 ? 1 : 0
  } finally {
    await db.close()
  }
}

function trackedProjects(root: string, log: Log): string[] {
  const file = process.env.EVEN_KEEL_CONFIG ?? join(root, 'even-keel.config.json')
  try {
    return Object.values(loadConfig(file).projects)
  } catch (error) {
    log(`tally: no Even Keel projects for rule files (${(error as Error).message})`)
    return []
  }
}

async function limitSnapshots(evenKeelUrl: string, stateDir: string, homes: AccountHomes, log: Log): Promise<Snapshot[]> {
  const url = process.env.EVEN_KEEL_URL ?? evenKeelUrl
  try {
    const response = await fetch(new URL('/api/state', url), { signal: AbortSignal.timeout(EVEN_KEEL_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return snapshotsOfState(await response.json())
  } catch (error) {
    log(`tally: Even Keel at ${url} gave no limits (${(error as Error).message}), reading rate-limits.json`)
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(join(stateDir, 'rate-limits.json'), 'utf8'))
    return snapshotsOfFile(raw, (dir) => homes.ownerOf(dir))
  } catch {
    return []
  }
}
