import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { listenOf, mcpPortOf } from './config.js'
import { stopOnSignals } from './diagnostics/stop.js'
import { runGit } from './git/run.js'
import { DatabaseMachineStore, MACHINE_DIR, openMachineDatabase, storedHub, storedRoot } from './link/machine-store.js'
import type { MachineEnd } from './link/machine.js'
import { httpsTransport } from './link/machine-transport.js'
import { parseToken } from './link/protocol.js'
import { HookReceiver } from './machine/hook-receiver.js'
import { loadEnv, root, stateDirOf } from './locations.js'
import { machineAbout } from './machine/about.js'
import { folderMarks } from './machine/marks.js'
import { KEEP_WARM_TICK_MS } from './sessions/keepwarm.js'
import { Writes } from './storage/database.js'
import { installed } from './updates/watcher.js'
import { CLI_CHECK_TICK_MS } from './service/cli-check.js'
import { SHUTDOWN_MS, WORK_TICK_MS } from './service/defaults.js'
import { assemblePollWorks } from './service/hub-bootstrap.js'
import { laterTell } from './service/machine-context.js'
import { assembleMachineHost } from './service/machine-host.js'
import { CONTACT_EVERY_MS, contactKeeper, holdInstallation } from './service/machine-process.js'
import { wireMachineSide } from './service/machine-side.js'

// A machine of a hub elsewhere (`docs/machines.md`, "Machines elsewhere", BTN-1247): the machine's assembly and its end
// of the link over HTTPS, nothing of the hub — no state database, no page, no trackers, no Tally. `src/start.ts` loads
// this module instead of the service once `join` made the installation a machine.

const log = (line: string): void => console.log(line)
const stateDir = stateDirOf()
const held = await holdInstallation(stateDir)
if (!('release' in held)) {
  console.error(`machine: another process (pid ${held.pid}) runs this installation; this one starts nothing`)
  process.exit(1)
}
const machineDb = await openMachineDatabase(join(stateDir, MACHINE_DIR))
const line = await storedHub(machineDb)
const token = line === undefined ? undefined : parseToken(line)
if (token === undefined) {
  console.error('machine: this installation keeps no connection to a hub; join one again (even-keel join <connection string>)')
  await machineDb.close()
  await held.release()
  process.exit(1)
}
const projectsRoot = (await storedRoot(machineDb)) ?? null
const version = installed(root).version

const writes = new Writes((text) => console.warn(text))
const tell = laterTell()
// There is no page here: the sessions' hooks ask this receiver at the page's port, and it carries them to the hub's page.
let linked: { end: MachineEnd } | undefined
let accounts: (() => unknown) | undefined
const receiver = new HookReceiver({
  forward: async (request) => linked?.end.hook(request),
  account: () => accounts?.() ?? null,
  log,
})
await receiver.start(listenOf(process.env).port)
const { host, machine } = await assembleMachineHost({
  machineDb,
  stateDir,
  writes,
  env: process.env,
  envFile: loadEnv(),
  listen: () => receiver.address,
  mcpPort: () => mcpPortOf(process.env),
  tell,
  planFirst: true,
})

const keepContact = contactKeeper(stateDir, log)
const side = wireMachineSide(machine, {
  transport: httpsTransport(token, { log }),
  store: new DatabaseMachineStore(machineDb),
  // The hub names the machine at its invitation; the machine knows itself by its host, so a mark names that.
  marks: folderMarks(() => ({ machine: token.machine, name: hostname() }), process.env),
  about: () => machineAbout({ evenKeel: version, root: projectsRoot, git: runGit, home: homedir() }),
  changed: (end) => keepContact(end.status().state === 'online', end.contact()),
  log,
})
linked = side
accounts = () => machine.account.view
const contact = setInterval(() => keepContact(side.end.status().state === 'online', side.end.contact()), CONTACT_EVERY_MS)
contact.unref()

// What the hub's own machine starts in `lifecycle.start` and `startTicks`, without the hub's parts.
host.monitor.start()
void host.owners.scan()
host.limits.start()
host.cliVersions.start()
host.cliCopies.resume()
host.account.start()
host.vscode.start()
void host.packages.start().catch((error: unknown) => console.warn(`packages: ${String(error)}`))
setInterval(() => void host.keepWarm.check(), KEEP_WARM_TICK_MS).unref()
setInterval(() => void host.cliChecks.check(), CLI_CHECK_TICK_MS).unref()
const pollWorks = assemblePollWorks(machine)
setInterval(pollWorks, WORK_TICK_MS).unref()

await side.end.settleMarks()
await side.end.start()
log(`machine: connecting to the hub ${token.hub} as machine ${token.machine}`)
// The hub's servers are reached over the link once the first connection may have brought the brief that names them.
void side.online.then(() => {
  log('machine: the hub took the first snapshot')
  side.throughHub()
  pollWorks()
})

stopOnSignals(async () => {
  clearInterval(contact)
  host.cliChecks.stop()
  await Promise.allSettled([host.packages.close(), machine.writes.settled(), writes.settled()])
  await side.end.flushed().catch(() => {})
  side.end.stop()
  await receiver.close()
  await machineDb.close()
  await held.release()
}, SHUTDOWN_MS)
// The ticks above are unref'd and the link may be down: this keeps the process until a stop signal.
setInterval(() => {}, 1 << 30)
