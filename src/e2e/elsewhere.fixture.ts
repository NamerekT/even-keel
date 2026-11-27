import type { PGlite } from '@electric-sql/pglite'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MachineAbout } from '../link/view.js'
import type { MachineHost } from '../service/machine-host.js'
import type { MachineContext } from '../service/machine-context.js'
import type { MachineSide } from '../service/machine-side.js'
import type { HookReceiver } from '../machine/hook-receiver.js'
import type { Writes } from '../storage/database.js'
import { ACCOUNT, freePort, type Harness } from './service.fixture.js'

/** The forge's remote as the bench's checkouts name it: `prepare` leads every clone of the bench to its bare repository. */
const FORGE_URL = 'http://127.0.0.1:9/john/example.git'

/**
 * A second installation in the bench's process, joined to the hub of `Harness` as a machine elsewhere (BTN-1306): its
 * own state folder, machine database, account folders and packages, its end of the link over HTTPS to the hub's door
 * for machines, assembled as `src/machine-service.ts` does. It runs on the hub's module graph, so the scripted agent and
 * the clock are the bench's. Needs `Harness.forge`: the connection clones the project's remote into `checkout`.
 */
export class Elsewhere {
  readonly dir: string
  /** The machine's folder of projects. */
  readonly root: string
  /** The project's folder the connection makes: the hub's folder name inside `root`. */
  readonly checkout: string
  readonly log: string[] = []
  machine = ''
  private parts: { db: PGlite; writes: Writes; receiver: HookReceiver; host: MachineHost; context: MachineContext; side: MachineSide; pollWorks: () => void } | undefined

  constructor(private readonly run: Harness) {
    this.dir = join(run.dir, 'elsewhere')
    this.root = join(this.dir, 'projects')
    this.checkout = join(this.root, 'repo')
  }

  get host(): MachineHost {
    if (this.parts === undefined) throw new Error('e2e: the machine elsewhere is not running')
    return this.parts.host
  }

  get context(): MachineContext {
    if (this.parts === undefined) throw new Error('e2e: the machine elsewhere is not running')
    return this.parts.context
  }

  /**
   * Run as `Harness.start`'s `prepared`: the machine's folders, its account folder trusting the project's folder, and
   * the forge's address led to the bare repository for every clone of the bench, the machine's among them.
   */
  prepare(): void {
    if (!this.run.forge) throw new Error('e2e: a machine elsewhere needs the forge')
    for (const folder of ['data', 'state', `accounts/${ACCOUNT}`, 'codex-accounts', 'opencode-accounts', 'copilot-accounts', 'claude', 'codex', 'projects']) mkdirSync(join(this.dir, folder), { recursive: true })
    // The machine's clone is made by the connection, not by the bench: its identity comes from the global config.
    appendFileSync(join(this.run.dir, '.gitconfig'), `[url "${this.run.remote.replaceAll('\\', '/')}"]\n\tinsteadOf = ${FORGE_URL}\n[user]\n\tname = John Doe\n\temail = john@example.com\n`)
    // The connection's step `trust` reads the machine's Claude configuration; Windows' CLI keys a folder with forward slashes.
    const trusted = JSON.stringify({ projects: { [this.checkout.replaceAll('\\', '/')]: { hasTrustDialogAccepted: true } } })
    for (const folder of ['claude', `accounts/${ACCOUNT}`]) writeFileSync(join(this.dir, folder, '.claude.json'), trusted)
    this.run.checkouts.push(this.checkout)
  }

  /** Joins the hub by a connection string of the page and starts the machine's end of the link: the machine's id. */
  async join(): Promise<string> {
    const { headOf } = await import('../updates/checkout.js')
    const { installed } = await import('../updates/watcher.js')
    const { loadEnv, root, source } = await import('../locations.js')
    const { encodeToken, isRefusal, parseToken } = await import('../link/protocol.js')
    const { httpsTransport, joinHub } = await import('../link/machine-transport.js')
    const { DatabaseMachineStore, MACHINE_DIR, openMachineDatabase, storeJoin } = await import('../link/machine-store.js')
    const { HookReceiver } = await import('../machine/hook-receiver.js')
    const { Writes } = await import('../storage/database.js')
    const { laterTell } = await import('../service/machine-context.js')
    const { assembleMachineHost } = await import('../service/machine-host.js')
    const { wireMachineSide } = await import('../service/machine-side.js')
    const { assemblePollWorks } = await import('../service/hub-bootstrap.js')
    const { WORK_TICK_MS } = await import('../service/defaults.js')
    const { machinePermission } = await import('../sessions/served.js')

    const log = (line: string) => void this.log.push(line)
    const invite = await this.run.answer<{ line: string }>('machines/invite', { name: 'Elsewhere', address: '127.0.0.1' })
    const commit = source === 'git' ? await headOf(root) : null
    const about: MachineAbout = {
      host: 'elsewhere', os: `${process.platform} test`, evenKeel: installed(root).version, node: process.versions.node, git: '2.47.0',
      agents: {}, gitUser: true, root: this.root, ...(commit !== null && { commit }),
    }
    const joined = await this.settled(joinHub(parseToken(invite.line)!, about, 5_000), 'the join')
    if (isRefusal(joined)) throw new Error(`e2e: the hub refused the machine: ${joined.refused}`)
    this.machine = joined.machine

    const stateDir = join(this.dir, 'state')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      EVEN_KEEL_DATA: join(this.dir, 'data'),
      EVEN_KEEL_ACCOUNTS_DIR: join(this.dir, 'accounts'),
      EVEN_KEEL_CODEX_ACCOUNTS_DIR: join(this.dir, 'codex-accounts'),
      EVEN_KEEL_OPENCODE_ACCOUNTS_DIR: join(this.dir, 'opencode-accounts'),
      EVEN_KEEL_COPILOT_ACCOUNTS_DIR: join(this.dir, 'copilot-accounts'),
      CLAUDE_CONFIG_DIR: join(this.dir, 'claude'),
      CODEX_HOME: join(this.dir, 'codex'),
    }
    const db = await openMachineDatabase(join(stateDir, MACHINE_DIR))
    await storeJoin(db, encodeToken(joined), this.root)
    const writes = new Writes(log)
    const tell = laterTell()
    let side: MachineSide | undefined
    let context: MachineContext | undefined
    let served: MachineHost | undefined
    const receiver = new HookReceiver({ forward: async (request) => side?.end.hook(request), account: () => context?.account.view ?? null, permission: machinePermission(() => served), log })
    await receiver.start(await freePort())
    const mcpPort = await freePort()
    const { host, machine } = await assembleMachineHost({ machineDb: db, stateDir, writes, env, envFile: loadEnv(), listen: () => receiver.address, mcpPort: () => mcpPort, tell, planFirst: true })
    context = machine
    served = host
    side = wireMachineSide(machine, { transport: httpsTransport(joined, { log }), store: new DatabaseMachineStore(db), about: async () => about, alone: true, log })
    const pollWorks = assemblePollWorks(machine)
    this.parts = { db, writes, receiver, host, context: machine, side, pollWorks }

    // What `src/machine-service.ts` starts, without the Tally collector.
    host.monitor.start()
    void host.owners.scan()
    host.limits.start()
    host.account.start()
    void host.packages.start().catch((error: unknown) => log(`packages: ${String(error)}`))
    setInterval(pollWorks, WORK_TICK_MS)
    await side.end.settleMarks()
    await side.moves.start()
    side.checkouts.start()
    await side.end.start()
    const online = side.online.then(() => {
      side.throughHub()
      pollWorks()
    })
    await this.settled(online, 'the machine online')
    return this.machine
  }

  /** Takes the machine off the link, its service running on: the hub sees it offline until `backOnLink`. */
  offLink(): void {
    this.parts?.side.end.stop()
  }

  /**
   * Puts the machine back on the link. After `Harness.restart` the hub's halt has cleared every fake timer of the
   * process, the machine's too: its monitor and its work poll start again, as on a machine whose service never stopped.
   */
  async backOnLink(): Promise<void> {
    const parts = this.parts
    if (parts === undefined) return
    const { WORK_TICK_MS } = await import('../service/defaults.js')
    await parts.host.monitor.stop()
    parts.host.monitor.start()
    setInterval(parts.pollWorks, WORK_TICK_MS)
    await parts.side.end.start()
  }

  /** Stops the machine before the hub: its end of the link, its packages, its receiver and its database. */
  async stop(): Promise<void> {
    const parts = this.parts
    if (parts === undefined) return
    this.parts = undefined
    parts.side.moves.stop()
    parts.side.checkouts.stop()
    parts.host.cliChecks.stop()
    parts.side.end.stop()
    await parts.host.monitor.stop()
    await Promise.allSettled([parts.host.packages.close(), parts.context.writes.settled(), parts.writes.settled()])
    await parts.receiver.close()
    await parts.db.close()
  }

  /** Waits for `promise` while the bench's clock moves: the hub's side of a request may run on its timers. */
  private async settled<T>(promise: Promise<T>, what: string): Promise<T> {
    let result: { value: T } | { error: unknown } | undefined
    promise.then((value) => (result = { value }), (error: unknown) => (result = { error }))
    await this.run.until(() => result !== undefined, what, { step: 100 })
    if ('error' in result!) throw result.error
    return result!.value
  }
}
