import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NoticeError, type Notice } from '../notice/notice.js'
import { BackupError, CHECK_FILE, ownCopies, ownName, type CopyCheck, type CopyJob } from './backup.js'
import { Backups, copyBeforeSteps, takeStartFailure } from './backup-schedule.js'
import { DATABASE_VERSION, openDatabase, SQLITE_VERSIONS, STEPS } from './database.js'
import { memoryDatabase } from './memory.js'
import { databaseDirOf, dataDirOf } from './owner.js'

const HOUR = 60 * 60_000

/** A copy the fake thread "made": its folder with a check, as the real one leaves it. */
function written(job: CopyJob, at: Date): CopyCheck {
  mkdirSync(job.dir, { recursive: true })
  const check: CopyCheck = { at: at.toISOString(), version: job.version, tables: {}, files: 0 }
  writeFileSync(join(job.dir, CHECK_FILE), JSON.stringify(check))
  return check
}

async function setup(options: { keep?: number; fail?: BackupError } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ek-backups-'))
  let dir = join(root, 'backups')
  let clock = new Date('2026-11-13T10:00:00Z')
  const jobs: CopyJob[] = []
  let fail = options.fail
  let hold: Promise<void> | null = null
  const lines: string[] = []
  let changes = 0
  const db = await memoryDatabase()
  const backups = new Backups({
    db,
    files: join(root, 'files'),
    settings: () => ({ dir, keep: options.keep ?? 14 }),
    run: async (job) => {
      jobs.push(job)
      if (hold !== null) await hold
      if (fail !== undefined) {
        mkdirSync(job.dir, { recursive: true })
        throw fail
      }
      return written(job, clock)
    },
    log: (line) => lines.push(line),
    changed: () => changes++,
    now: () => clock,
  })
  return {
    backups,
    jobs,
    lines,
    get changes() { return changes },
    get dir() { return dir },
    moveTo: (name: string) => { dir = join(root, name) },
    pass: (ms: number) => { clock = new Date(clock.getTime() + ms) },
    failWith: (error: BackupError | undefined) => { fail = error },
    holdRuns: () => {
      let release = () => {}
      hold = new Promise<void>((resolve) => { release = () => { hold = null; resolve() } })
      return release
    },
  }
}

describe('the automatic backup', () => {
  it('copies at the first look when there is no checked copy, at the schema of the database, and shows its time', async () => {
    const t = await setup()
    expect(t.backups.view()).toMatchObject({ at: null, running: false, failure: null, dir: t.dir })
    await t.backups.look()
    expect(t.jobs).toHaveLength(1)
    expect(t.jobs[0]).toMatchObject({ version: DATABASE_VERSION, dir: join(t.dir, ownName(new Date('2026-11-13T10:00:00Z'), DATABASE_VERSION)) })
    expect(Object.keys(JSON.parse(t.jobs[0]!.rows) as object)).toContain('builtin_files')
    expect(t.backups.view()).toMatchObject({ at: '2026-11-13T10:00:00.000Z', running: false, failure: null })
    expect(t.lines.some((line) => /storage: the backup read the database in \d+ ms/.test(line))).toBe(true)
    expect(t.changes).toBeGreaterThan(0)
  })

  it('copies again only when the newest checked copy is older than a day', async () => {
    const t = await setup()
    await t.backups.look()
    t.pass(23 * HOUR)
    await t.backups.look()
    expect(t.jobs).toHaveLength(1)
    t.pass(2 * HOUR)
    await t.backups.look()
    expect(t.jobs).toHaveLength(2)
  })

  it('keeps the newest copies of the setting', async () => {
    const t = await setup({ keep: 2 })
    for (let day = 0; day < 4; day++) {
      await t.backups.look()
      t.pass(25 * HOUR)
    }
    expect(readdirSync(t.dir)).toEqual([t.jobs[2]!.dir, t.jobs[3]!.dir].map((path) => path.slice(t.dir.length + 1)))
  })

  it('a failed copy removes its folder, keeps the older copies, shows a notice and is retried after an hour', async () => {
    const t = await setup({ keep: 1 })
    await t.backups.look()
    t.pass(25 * HOUR)
    t.failWith(new BackupError('check', 'rows differ: settings has 1 of 2'))
    await t.backups.look()
    expect(existsSync(t.jobs[1]!.dir)).toBe(false)
    expect(existsSync(t.jobs[0]!.dir)).toBe(true)
    expect(t.backups.view().failure).toMatchObject({ code: 'storage.backupCheckFailed' } satisfies Partial<Notice>)
    expect(t.lines.some((line) => line.includes('rows differ: settings has 1 of 2'))).toBe(true)
    t.pass(30 * 60_000)
    await t.backups.look()
    expect(t.jobs).toHaveLength(2)
    t.failWith(new BackupError('copy', 'no space left'))
    t.pass(31 * 60_000)
    await t.backups.look()
    expect(t.jobs).toHaveLength(3)
    expect(t.backups.view().failure).toMatchObject({ code: 'storage.backupFailed' })
    t.failWith(undefined)
    t.pass(HOUR)
    await t.backups.look()
    expect(t.backups.view()).toMatchObject({ failure: null, at: t.backups.view().at })
    expect(readdirSync(t.dir)).toEqual([t.jobs[3]!.dir.slice(t.dir.length + 1)])
  })

  it('copies on request at once, and refuses a second request while one runs', async () => {
    const t = await setup()
    const release = t.holdRuns()
    t.backups.copyNow()
    await expect.poll(() => t.jobs.length).toBe(1)
    expect(t.backups.view().running).toBe(true)
    expect(() => t.backups.copyNow()).toThrow(NoticeError)
    expect(() => t.backups.copyNow()).toThrow(expect.objectContaining({ notice: { code: 'storage.backupRunning', params: {} } }))
    release()
    await t.backups.idle()
    expect(t.backups.view()).toMatchObject({ running: false, at: '2026-11-13T10:00:00.000Z' })
  })

  it('reads the last copy from the folder of the setting once it changes', async () => {
    const t = await setup()
    await t.backups.look()
    t.moveTo('elsewhere')
    expect(t.backups.view()).toMatchObject({ at: null, dir: t.dir })
  })

  it('shows the failure of the copy made before the schema steps until a copy succeeds', async () => {
    const t = await setup()
    t.backups.failedAtStart({ code: 'storage.backupFailed', params: {} })
    expect(t.backups.view().failure).toMatchObject({ code: 'storage.backupFailed' })
    await t.backups.look()
    expect(t.backups.view().failure).toBeNull()
  })
})

describe('the copy before the schema steps', () => {
  const OLD = DATABASE_VERSION - 2

  /** A state folder whose database is `OLD`, with the backup settings' rows. */
  async function oldState(settings: Record<string, unknown> = {}) {
    const stateDir = mkdtempSync(join(tmpdir(), 'ek-before-'))
    const dataDir = dataDirOf(databaseDirOf(stateDir))
    const db = await openDatabase(dataDir, STEPS.slice(0, OLD - SQLITE_VERSIONS))
    for (const [key, value] of Object.entries(settings)) {
      await db.query("insert into setting_definitions (key, kind, spec, scopes) values ($1, 'string', '{}', 'global')", [key])
      await db.query("insert into setting_values (key, qualifier, value, updated_at, updated_by) values ($1, '', $2, now()::text, 'test')", [key, JSON.stringify(value)])
    }
    await db.close()
    return { stateDir, dataDir }
  }

  it('is made on the old schema into the folder of the setting, checked, before the steps', { timeout: 120_000 }, async () => {
    const lines: string[] = []
    const { stateDir, dataDir } = await oldState()
    const dir = join(stateDir, 'elsewhere')
    const { dataDir: other } = await oldState({ 'backup.dir': dir, 'backup.keep': 3 })
    const db = await openDatabase(other, STEPS, copyBeforeSteps(stateDir, (line) => lines.push(line)))
    await db.close()
    expect(ownCopies(dir).map((copy) => copy.check?.version)).toEqual([OLD])
    expect(takeStartFailure()).toBeNull()
    expect(lines.some((line) => line.includes(`the copy before the schema steps from ${OLD} is checked`))).toBe(true)
    // A database already at the current schema takes no copy.
    const current = await openDatabase(dataDir, STEPS)
    await current.close()
    const again = await openDatabase(dataDir, STEPS, copyBeforeSteps(stateDir, () => {}))
    await again.close()
    expect(existsSync(join(stateDir, 'backups'))).toBe(false)
  })

  it('does not stop the steps when it fails, and leaves its notice for the service', { timeout: 120_000 }, async () => {
    const { stateDir, dataDir } = await oldState()
    writeFileSync(join(stateDir, 'backups'), 'a file where the folder would be')
    const db = await openDatabase(dataDir, STEPS, copyBeforeSteps(stateDir, () => {}))
    await db.close()
    expect(takeStartFailure()).toMatchObject({ code: 'storage.backupFailed' })
    expect(takeStartFailure()).toBeNull()
  })
})
