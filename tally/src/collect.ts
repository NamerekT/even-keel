import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { AccountHomes, accountsRoot } from '../../src/account/homes.js'
import { taskSources } from '../../src/chain/launches.js'
import type { LaunchEntry } from '../../src/chain/model.js'
import { readSnapshots, type HandoffSnapshot } from '../../src/chain/snapshots.js'
import { readLaunches } from '../../src/chain/store.js'
import { loadConfig } from '../../src/config.js'
import { HALTED } from '../../src/stats/tally-schema.js'
import { sqliteInMemory } from '../../src/storage/copy.js'
import { SQLITE_FILE } from '../../src/storage/database.js'
import { readStateDatabase, type StateReader } from '../../src/storage/owner.js'
import { readStateFiles } from '../../src/storage/state-files.js'
import { parseConfig, unpricedToLog, type DbSettings } from './config.js'
import { TallyDb } from './db.js'
import { refreshHandoffs } from './handoffs.js'
import type { HulyProfiles } from '../../src/stats/tally.js'
import { hulyOfProfiles } from './huly-profiles.js'
import { snapshotsOfFile, snapshotsOfState, type Snapshot } from './limits.js'
import { loadFile, loadRollout, type Source } from './load.js'
import { deniedLine, migratedLine } from './migrations.js'
import { launchMap } from './parse.js'
import { transcriptSession } from './rule-history.js'
import { readBackup, ruleSources, skillsOf } from './rule-scan.js'
import { backfillRules, collectRuleHistory, importRuleHistory, refreshRuleChanges, snapshotRules } from './rule-steps.js'
import { copilotSources, loadCopilot } from './copilot.js'
import { loadOpenCode, openCodeSources } from './opencode.js'
import { rolloutFiles, transcriptFiles } from './scan.js'
import { classifySpans, refreshSigns, refreshSteps, refreshTasks, refreshTurns, reportTaskTimes } from './steps.js'

const CHUNK_BYTES = 8 * 1024 * 1024
const EVEN_KEEL_TIMEOUT_MS = 5_000

export type Log = (message: string) => void

// One collector run: the exit code is 1 when a file failed to load, everything else is written anyway.
// `root` — Even Keel's code, `home` — its data (the same folder in a checkout, BTN-265).
export async function collect(settings: DbSettings, root: string, home: string, log: Log, huly: HulyProfiles): Promise<number> {
  const started = Date.now()
  const config = parseConfig(JSON.parse(readFileSync(process.env.TALLY_CONFIG ?? join(root, 'tally', 'tally.config.json'), 'utf8')))
  const stateDir = process.env.EVEN_KEEL_STATE_DIR ?? join(home, 'state')
  const homes = new AccountHomes(process.env, accountsRoot(process.env))
  const { launches: journal, handoffs: saved, repos } = await evenKeelState(stateDir, log)
  const launches = launchMap(journal)
  const taskHomes = taskSources(journal)
  const hulyOf = hulyOfProfiles(huly, new Map(taskHomes.flatMap((home) => (home.profile === null ? [] : [[home.task, home.profile] as const]))))

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
    const migrated = migratedLine(migration)
    if (migrated !== null) log(migrated)
    await db.syncPrices(config.prices)

    const projects = repos ?? trackedProjects(home, log)
    const ruleScan = await ruleSources(homes.list(), projects.map((project) => project.repo), homedir(), log)
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
    const rollouts = await rolloutFiles(homes.list())
    const openCode = openCodeSources(homes.list())
    const copilot = await copilotSources(homes.list())
    const loads = [
      ...sources.map((source) => () => loadFile(source, stored.get(source.path), db, contextOf(source), CHUNK_BYTES)),
      ...rollouts.map((source) => () => loadRollout(source, stored.get(source.path), db, { account: source.account, launches })),
      ...openCode.map((source) => () => loadOpenCode(source, stored.get(source.path), db, { account: source.account, launches })),
      ...copilot.map((source) => () => loadCopilot(source, stored.get(source.path), db, { account: source.account, launches })),
    ]
    const paths = [...sources, ...rollouts, ...openCode, ...copilot].map((source) => source.path)
    for (const [index, load] of loads.entries()) {
      try {
        const read = await load()
        if (read > 0) files++
        lines += read
      } catch (error) {
        failed++
        log(`tally: ${paths[index]}: ${(error as Error).message}`)
      }
    }
    const forgotten = paths.length > 0 ? await db.forgetFilesExcept(paths) : 0
    const relabeled = await db.syncLaunches(launches)
    await db.syncTaskSources(taskHomes)
    await db.fillSessionFolders()
    if ((await db.meta('efforts')) === null) {
      log(`tally: ${await db.fillEfforts()} older messages given their effort level`)
      await db.setMeta('efforts', new Date().toISOString())
    }
    const prompted = await db.fillPrompts()
    const handoffs = await refreshHandoffs(db, saved, sources, journal)
    const snapshots = await db.addSnapshots(await limitSnapshots(config.evenKeelUrl, stateDir, homes, log))
    const versions = await snapshotRules(db, ruleScan, new Date())
    const history = await collectRuleHistory(db, homes.list(), projects, homedir(), log)
    const changes = await refreshRuleChanges(db)
    const imported = await importRuleHistory(db, resolve(root, config.ruleHistory ?? join(stateDir, 'rule-history.jsonl')), log)
    const signed = await refreshSigns(db, config.signs)
    const turned = await refreshTurns(db)
    const stepped = await refreshSteps(db, config.steps)
    const tasks = await refreshTasks(db, hulyOf, log)
    const reports = await reportTaskTimes(db, config.reportsSince, hulyOf, log)
    const classified = await classifySpans(db, config.classify, log)
    const unpriced = unpricedToLog(await db.unpricedModels(), config.unpriced)
    if (unpriced.length > 0) log(`tally: no price for ${unpriced.join(', ')} — add them to tally.config.json`)

    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    log(
      `tally: ${paths.length} files (${rollouts.length} Codex, ${openCode.length} OpenCode, ${copilot.length} Copilot),${files} read, ${lines} lines, ${failed} failed, ${forgotten} forgotten, ` +
        `${relabeled} sessions relabeled, ${prompted} prompts, ${handoffs} handoffs, ${snapshots} limit snapshots,` +
        `${ruleFiles.length} rule files (${versions} new versions, ${history} from git, ${changes} new changes), ${imported} imported rule sets, ` +
        `${signed.sessions} sessions signed (${signed.spans} spans), ${turned} sessions split into turns, ${stepped} into steps, ${tasks} Huly tasks, ${reports} time reports, ${classified} spans classified, ${seconds} s`,
    )
    return failed > 0 ? 1 : 0
  } finally {
    await db.close()
  }
}

/**
 * The launch log and the handoff snapshots from Even Keel's database, through the service's port while it runs.
 * Without one — a merge reaches the collector before the service restarts and imports the old state — from the
 * `node:sqlite` file of versions 1–2, otherwise from the v0.1 files of the state folder. `repos` — the folders and
 * branches of the projects of the database (BTN-199); `undefined` without it, when the config file still holds them.
 */
async function evenKeelState(stateDir: string, log: Log): Promise<{ launches: LaunchEntry[]; handoffs: HandoffSnapshot[]; repos?: TrackedProject[] }> {
  try {
    const database = await readStateDatabase(stateDir)
    const reader = database ?? (await legacyReader(stateDir))
    if (reader === undefined) {
      const files = readStateFiles(stateDir)
      return { launches: files?.launches ?? [], handoffs: files?.handoffs ?? [] }
    }
    try {
      const repos = database === undefined ? undefined : (await reader.db.query<TrackedProject>('select repo, branch from projects order by position')).rows
      return { launches: await readLaunches(reader.db), handoffs: await readSnapshots(reader.db), repos }
    } finally {
      await reader.close()
    }
  } catch (error) {
    log(`tally: Even Keel's launch log is not read (${(error as Error).message})`)
    return { launches: [], handoffs: [] }
  }
}

async function legacyReader(stateDir: string): Promise<StateReader | undefined> {
  const file = join(stateDir, SQLITE_FILE)
  if (!existsSync(file)) return undefined
  const db = await sqliteInMemory(file)
  return { db, close: () => db.close() }
}

type TrackedProject = { repo: string; branch: string }

function trackedProjects(home: string, log: Log): TrackedProject[] {
  const file = process.env.EVEN_KEEL_CONFIG ?? join(home, 'even-keel.config.json')
  try {
    const config = loadConfig(file)
    return Object.entries(config.projects).map(([key, repo]) => ({ repo, branch: config.settings[key]!.branch }))
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
