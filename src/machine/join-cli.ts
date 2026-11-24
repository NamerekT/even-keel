import { homedir } from 'node:os'
import { join } from 'node:path'
import { runGit } from '../git/run.js'
import { askToJoin, joinHub } from '../link/machine-transport.js'
import { encodeToken } from '../link/protocol.js'
import { MACHINE_DIR, openMachineDatabase, storeJoin } from '../link/machine-store.js'
import { home, inContainer, stateDirOf } from '../locations.js'
import { databaseDirOf, readOwner, readStateDatabase } from '../storage/owner.js'
import { machineAbout } from './about.js'
import { joinAsMachine, joinedWith, JoinRefused } from './join.js'

/** `even-keel join` as the CLI runs it: the lines to print, or the reason it refused. */
export async function joinFromCli(line: string, root: string | null, version: string, print: (line: string) => void = console.log): Promise<string[] | string> {
  const stateDir = stateDirOf()
  const joined = joinedWith(stateDir, line)
  if (joined !== undefined) return [`even-keel: this installation is a machine of the hub ${joined.hub} already; its projects go into ${joined.root}`]
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
      about: (folder) => machineAbout({ evenKeel: version, root: folder, container: inContainer, git: runGit, home: homedir() }),
      exchange: (token, about) => joinHub(token, about),
      ask: (hub, about) =>
        askToJoin(hub, about, {
          shown: (code, expiresAt) => {
            const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000))
            print(`even-keel: open the hub page and let this machine in (${hub})`)
            print(`  code: ${code}        (waiting for the hub page, ${minutes} min)`)
            print('  the page shows the same code: if it shows another, decline it, someone is in the middle')
          },
        }),
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
    if (error instanceof JoinRefused) return `not joined: ${error.message}`
    throw error
  }
}
