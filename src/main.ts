import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listenOf } from './config.js'
import { guardHosts, guardToken } from './guard.js'
import { configPath, loadEnv, root, stateDirOf } from './locations.js'
import { englishOf, noticeOf, type Notice } from './notice/notice.js'
import { createBlockedServer } from './server.js'
import { upgradeStorage } from './storage/migrations.js'

// The storage is brought to the current schema before the service reads any of it; when it cannot be, the service
// starts nothing and writes nothing, and the page shows why.
loadEnv()
let blocked: Notice | undefined
try {
  upgradeStorage({ configFile: configPath(), stateDir: stateDirOf(), log: (line) => console.log(line) })
} catch (error) {
  blocked = noticeOf(error)
}

if (blocked === undefined) await import('./service.js')
else serveBlocked(blocked)

function serveBlocked(reason: Notice): void {
  console.error(`${englishOf(reason)}; the service started nothing and serves the page only`)
  const listen = listenOf(process.env)
  const token = guardToken(process.env, listen.host)
  const hosts = guardHosts(listen.host, allowedHosts(configPath()))
  const server = createBlockedServer({ guard: () => ({ hosts, token }), publicDir: join(root, 'dist', 'web'), reason })
  server.listen(listen.port, listen.host, () => console.log(`even-keel listening on http://${listen.host}:${listen.port}, blocked`))
}

/** The config's `allowedHosts` as far as it can be read: the file may be from a newer Even Keel or broken. */
function allowedHosts(file: string): string[] {
  try {
    const { allowedHosts } = JSON.parse(readFileSync(file, 'utf8')) as { allowedHosts?: unknown }
    return Array.isArray(allowedHosts) ? allowedHosts.filter((host): host is string => typeof host === 'string') : []
  } catch {
    return []
  }
}
