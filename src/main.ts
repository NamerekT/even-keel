import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listenOf } from './config.js'
import { guardHosts, guardToken } from './guard.js'
import { configPath, loadEnv, root, stateDirOf } from './locations.js'
import { englishOf, noticeOf, type Notice } from './notice/notice.js'
import { createBlockedServer } from './server.js'
import { prepareSettings } from './settings/import.js'
import { upgradeStorage } from './storage/migrations.js'
import { keepDatabase, keptDatabase } from './storage/owner.js'
import { IMPORTED_SUFFIX, prepareDatabase } from './storage/state-files.js'

// The storage is brought to the current schema before the service reads any of it; when it cannot be, the service
// starts nothing and writes nothing, and the page shows why.
loadEnv()
let blocked: Notice | undefined
try {
  upgradeStorage({ configFile: configPath(), stateDir: stateDirOf(), log: (line) => console.log(line) })
  const database = await prepareDatabase({ stateDir: stateDirOf(), log: (line) => console.log(line) })
  keepDatabase(database)
  await prepareSettings({ db: database.db, file: configPath(), log: (line) => console.log(line) })
} catch (error) {
  blocked = noticeOf(error)
}

if (blocked === undefined) await import('./service.js')
else await serveBlocked(blocked)

async function serveBlocked(reason: Notice): Promise<void> {
  console.error(`${englishOf(reason)}. The service started nothing and wrote nothing; it serves the page only`)
  const listen = listenOf(process.env)
  const token = guardToken(process.env, listen.host)
  const hosts = guardHosts(listen.host, await allowedHosts(configPath()))
  const server = createBlockedServer({ guard: () => ({ hosts, token }), publicDir: join(root, 'dist', 'web'), reason })
  server.listen(listen.port, listen.host, () => console.log(`even-keel listening on http://${listen.host}:${listen.port}, blocked`))
}

/**
 * `allowedHosts` as far as it can be read, so that the blocked page opens where the service's page did: from the
 * database when it opened, else from the config file not imported yet or the one kept after the import. Any of them
 * may be from a newer Even Keel or broken.
 */
async function allowedHosts(file: string): Promise<string[]> {
  const hostsOf = (value: unknown) => (Array.isArray(value) ? value.filter((host): host is string => typeof host === 'string') : [])
  try {
    const { rows } = await keptDatabase().db.query<{ value: string }>("select value from setting_values where key = 'allowedHosts' and project_id is null")
    if (rows[0] !== undefined) return hostsOf(JSON.parse(rows[0].value))
  } catch {
    // No database, or not of this version: the files below.
  }
  for (const each of [file, `${file}${IMPORTED_SUFFIX}`]) {
    try {
      return hostsOf((JSON.parse(readFileSync(each, 'utf8')) as { allowedHosts?: unknown }).allowedHosts)
    } catch {
      // Missing or broken: the next one.
    }
  }
  return []
}
