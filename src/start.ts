import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { listenOf, mcpPortOf } from './config.js'
import { startDiagnostics } from './diagnostics/start-watch.js'
import { logFatalErrors } from './diagnostics/stop.js'
import { fetchOverHttp1 } from './fetch-dispatcher.js'
import { guardHosts, guardToken } from './guard.js'
import { configPath, home, loadEnv, root, stateDirOf } from './locations.js'
import { causeLine, englishOf, noticeWithCause, sameNotice } from './notice/notice.js'
import { holdGatewayPort, releaseHeldPort } from './packages/held-port.js'
import { createBlockedServer } from './server.js'
import { joinedHub, machineOnly, waitForJoin } from './service/machine-process.js'
import { prepareSettings } from './settings/import.js'
import { copyBeforeSteps } from './storage/backup-schedule.js'
import { upgradeStorage } from './storage/migrations.js'
import { DatabaseHeldError, keepDatabase, keptDatabase } from './storage/owner.js'
import { startWithStorageRetry, type BlockedPage } from './storage/startup.js'
import { IMPORTED_SUFFIX, prepareDatabase } from './storage/state-files.js'
import { compactDatabase } from './storage/vacuum.js'

// The storage is brought to the current schema before the service reads any of it; when it cannot be, the service
// starts nothing and writes nothing, and the page shows why.
logFatalErrors()
fetchOverHttp1()
loadEnv()
await startDiagnostics(join(home, 'logs'), line => console.log(line))
const modulesMs = performance.now()
// A machine's container never starts as a hub before its join (BTN-1440).
if (machineOnly(process.env)) await waitForJoin(stateDirOf(), { log: (line) => console.log(line) })
// Sessions' CLIs reach the gateway again within seconds of a restart, not after the whole start (BTN-1544).
holdGatewayPortOf(process.env)
// A machine of a hub elsewhere has no state database and no page (BTN-1247): `join` made it one.
const ready = joinedHub(stateDirOf()) ? (await import('./machine-service.js'), false) : await startWithStorageRetry({
  prepare: async () => {
    upgradeStorage({ configFile: configPath(), stateDir: stateDirOf(), log: (line) => console.log(line) })
    const log = (line: string) => console.log(line)
    const database = await prepareDatabase({ stateDir: stateDirOf(), log, beforeSteps: copyBeforeSteps(stateDirOf(), log) })
    keepDatabase(database)
    await compactDatabase(database.db, (line) => console.log(line))
    await prepareSettings({ db: database.db, file: configPath(), log: (line) => console.log(line) })
  },
  blocked: serveBlocked,
  log: (line) => console.log(line),
})

const storageMs = performance.now()
if (ready) {
  await import('./service.js')
  const ms = (value: number) => `${(value / 1000).toFixed(1)} s`
  console.log(`start: modules ${ms(modulesMs)}, storage ${ms(storageMs - modulesMs)}, service ${ms(performance.now() - storageMs)}`)
}
// The gateway took the port as the service started; a hold still here (another port in `.env` by now) waits for nothing.
await releaseHeldPort()

function holdGatewayPortOf(env: NodeJS.ProcessEnv): void {
  try {
    holdGatewayPort(mcpPortOf(env))
  } catch {
    // A bad EVEN_KEEL_MCP_PORT is the service's to report as it starts.
  }
}

async function serveBlocked(error: unknown): Promise<BlockedPage> {
  await releaseHeldPort()
  const logBlocked = (error: unknown) => {
    console.error(`${englishOf(noticeWithCause(error))}. The service started nothing and wrote nothing; it serves the page only`)
    const cause = causeLine(error)
    if (cause !== undefined) console.error(cause)
  }
  logBlocked(error)
  const listen = listenOf(process.env)
  const token = guardToken(process.env, listen.host)
  const hosts = guardHosts(listen.host, await allowedHosts(configPath()))
  const deps = { guard: () => ({ hosts, token }), publicDir: join(root, 'dist', 'web'), reason: noticeWithCause(error) }
  const server = createBlockedServer(deps)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(listen.port, listen.host, () => {
      server.removeListener('error', reject)
      console.log(`even-keel listening on http://${listen.host}:${listen.port}, blocked`)
      resolve()
    })
  })
  return {
    update: (error) => {
      const reason = noticeWithCause(error)
      if (sameNotice(reason, deps.reason)) return
      deps.reason = reason
      if (!(error instanceof DatabaseHeldError)) logBlocked(error)
      server.closeAllConnections()
    },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error))
      server.closeAllConnections()
    }),
  }
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
