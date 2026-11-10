import type { PGlite } from '@electric-sql/pglite'

// PGlite is one session without autovacuum workers: nothing reclaims the rows an update or a delete leaves dead
// unless the owner asks (BTN-952, `docs/storage.md`, "Vacuum").

/** How often the running service vacuums the state database. */
export const VACUUM_EVERY_MS = 60 * 60_000

type Log = (line: string) => void

async function run(db: PGlite, statements: string[], log: Log): Promise<boolean> {
  try {
    // One statement a call: `VACUUM` refuses to run inside the transaction a multi-statement `exec` is.
    for (const sql of statements) await db.exec(sql)
    return true
  } catch (error) {
    log(`storage: the vacuum failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/** Makes the dead rows of every table reusable; the files do not shrink. For the running service: tens of ms. */
export async function vacuumDatabase(db: PGlite, log: Log = console.warn): Promise<void> {
  await run(db, ['vacuum'], log)
}

/**
 * Rewrites every table without its dead rows and counts the live ones for the planner. It locks each table and takes
 * about a second on a bloated database: for the start, before the service reads anything.
 */
export async function compactDatabase(db: PGlite, log: Log = console.warn): Promise<void> {
  const from = performance.now()
  if (await run(db, ['vacuum full', 'analyze'], log)) log(`storage: the database was compacted in ${Math.round(performance.now() - from)} ms`)
}
