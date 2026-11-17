import { homedir } from 'node:os'
import { join } from 'node:path'
import { runGit } from '../git/run.js'
import { joinHub } from '../link/machine-transport.js'
import { encodeToken } from '../link/protocol.js'
import { MACHINE_DIR, openMachineDatabase, storeJoin } from '../link/machine-store.js'
import { home, stateDirOf } from '../locations.js'
import { databaseDirOf, readOwner, readStateDatabase } from '../storage/owner.js'
import { machineAbout } from './about.js'
import { joinAsMachine, JoinRefused } from './join.js'

/** `even-keel join` as the CLI runs it: the lines to print, or the reason it refused. */
export async function joinFromCli(line: string, root: string | null, version: string): Promise<string[] | string> {
  const stateDir = stateDirOf()
  try {
    const file = await joinAsMachine(line, root ?? undefined, {
      stateDir,
      env: process.env,
      defaultRoot: join(home, 'projects'),
      serviceRuns: async () => (await readOwner(databaseDirOf(stateDir))) !== null,
      projects: async () => {
        const reader = await readStateDatabase(stateDir)
        if (reader === undefined) return 0
        try {
          const { rows } = await reader.db.query<{ count: string }>('select count(*) as count from projects')
          return Number(rows[0]?.count ?? 0)
        } finally {
          await reader.close()
        }
      },
      about: (folder) => machineAbout({ evenKeel: version, root: folder, git: runGit, home: homedir() }),
      exchange: (token, about) => joinHub(token, about),
      keep: async (token, folder) => {
        const db = await openMachineDatabase(join(stateDir, MACHINE_DIR))
        try {
          await storeJoin(db, encodeToken(token), folder)
        } finally {
          await db.close()
        }
      },
      now: Date.now,
    })
    return [
      `even-keel: this installation is now a machine of the hub ${file.hub}`,
      `  its projects go into ${file.root}`,
      '  the hub gives it projects from its page; start the service to connect: it runs as a machine, with no page of its own',
    ]
  } catch (error) {
    if (error instanceof JoinRefused) return `even-keel: not joined: ${error.message}`
    throw error
  }
}
