import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { chainOrder } from '../chain/order.js'
import type { LaunchEntry } from '../chain/dispatcher.js'
import { launchLine } from '../chain/log.js'
import { saveSnapshot } from '../chain/snapshots.js'
import { DatabaseHubStore } from '../link/hub-store.js'
import { HubEnd } from '../link/hub.js'
import { LOCAL_HEARTBEAT_MS, LocalTransport } from '../link/local.js'
import { DatabaseMachineStore, openMachineDatabase } from '../link/machine-store.js'
import { MachineEnd } from '../link/machine.js'
import { bearerOf } from '../link/protocol.js'
import { stateDirOf } from '../locations.js'
import { Assignments, fillPool } from '../machine/assignments.js'
import { sameJson } from '../machine/facts.js'
import { ownMachine } from '../machine/own.js'
import type { PageReads } from '../machine/page.js'
import { MachineMoves } from '../machine/moves.js'
import type { MachinePort } from '../machine/port.js'
import { RemoteMachine } from '../machine/remote.js'
import { LAUNCH_EVENT, MachineRecords, saveMachineRecord } from '../machine/records.js'
import { HANDOFF_EVENT, MachineRunner } from '../machine/runner.js'
import { samePath } from '../paths.js'
import type { SessionMail } from '../sessions/mail.js'
import { loadSessionWindows } from '../storage/context-windows.js'
import type { ChainContext } from './chain.js'
import { KEPT_WRITE_EVENT, type KeptWrite } from '../taskmcp/machine.js'
import { HubMcp, machineTasks } from './hub-mcp.js'
import { wireMachine } from './machine-chain.js'

/** The folder of the machine's own database inside the state folder, next to the hub's `even-keel/`. */
export const MACHINE_DIR = 'machine'
/** How long the start waits for the machine's first snapshot; past it the chain simply does not step until it comes. */
const FIRST_SNAPSHOT_MS = 30_000
/** How often the machine posts what changed when no step of the chain asked for it: the page's actions read the mirror too. */
const PUBLISH_EVERY_MS = 5_000

export interface LinkedMachine {
  /** The hub's side of the port: what the chain is given. */
  port: MachinePort
  assignments: Assignments
  records: MachineRecords
  /** What the page and the chat read of the machine's sessions and accounts: its mirror, never the machine's objects. */
  page: PageReads
  /**
   * Connects the machine to its hub and waits for its first snapshot. Called once the dispatcher exists: the machine's
   * facts read the chain's state. Until then the mirror is empty and the chains do not step.
   */
  start(): Promise<void>
  /** Stops both ends and closes the machine's database. */
  close(): Promise<void>
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * A hub and its own machine in one process (`docs/machines.md`, "One process"): the chain's port is `RemoteMachine`,
 * the local port runs behind `MachineRunner`, and the two talk through `HubEnd` and `MachineEnd` over a carrier that
 * is a call. Nothing is connected until `start`.
 */
export async function wireLinkedMachine(ctx: ChainContext): Promise<LinkedMachine> {
  const log = (line: string): void => console.log(line)
  const machineDb = await openMachineDatabase(join(stateDirOf(), MACHINE_DIR))
  const hubStore = new DatabaseHubStore(ctx.db)
  const machineStore = new DatabaseMachineStore(machineDb)
  let own = ''

  const assignments = await Assignments.open({
    db: ctx.db,
    writes: ctx.writes,
    order: (project) => {
      try {
        return chainOrder(ctx.tasksByProject.get(project) ?? [], ctx.dispatcher.state.orders[project])
      } catch {
        return []
      }
    },
  })

  let agreedFor = ''
  /** The machine serves the projects of its own installation, each in its folder; a project gone is served no longer. */
  const agree = async (): Promise<void> => {
    const { projects } = ctx.configStore.current
    const signature = JSON.stringify(projects)
    if (signature === agreedFor) return
    for (const { project, folder } of await machineStore.consents()) {
      const repo = projects[project]
      if (repo === undefined || !samePath(repo, folder)) await machineStore.withdraw(project, folder)
    }
    for (const [project, repo] of Object.entries(projects)) await machineStore.agree(project, repo)
    await fillPool(ctx.db, own, Object.keys(projects))
    agreedFor = signature
  }

  const catchUp = async (): Promise<void> => {
    try {
      await agree()
      if (end.status().state !== 'online') return
      await runner.publish()
      await end.flushed()
    } catch (error) {
      log(`machine: the hub could not catch up with its own machine: ${messageOf(error)}`)
    }
  }

  const remote: RemoteMachine = new RemoteMachine({
    send: (machine, command) => hub.send(machine, command),
    machine: () => own,
    projectOf: ctx.projectOf,
    projectOfSession: (sessionId) => ctx.launches.findLast((entry) => entry.sessionId === sessionId)?.project,
    lastSession: (project, task) => ctx.launches.findLast((entry) => entry.project === project && entry.task === task)?.sessionId,
    saveSnapshot: (snapshot) => saveSnapshot(ctx.db, snapshot),
    record: async (event) => {
      if (!await saveMachineRecord(ctx.db, own, event)) return
      if (event.type === LAUNCH_EVENT) {
        const entry = event.payload as LaunchEntry
        ctx.launches.push(entry)
        ctx.eventLog.launched(entry)
        log(launchLine(entry))
      }
      ctx.hub.broadcastSoon('state', () => ctx.getState())
    },
    assigned: (project, task) => assignments.assign(project, task, own),
    released: (project, task) => assignments.release(project, task),
    held: (named, live) => assignments.reconcile(own, named, live),
    catchUp,
    changed: () => ctx.hub.broadcastSoon('state', () => ctx.getState()),
    log,
  })
  const hubMcp = new HubMcp({ db: ctx.db, origin: () => ctx.packages.hubOrigin, projects: () => Object.keys(ctx.configStore.current.projects), log })
  const handlers = remote.handlers()
  const hub: HubEnd = new HubEnd({
    store: hubStore,
    handlers: {
      ...handlers,
      event: (machine, event) => (event.type === KEPT_WRITE_EVENT ? hubMcp.write(machine, event.payload as KeptWrite) : handlers.event(machine, event)),
      mcp: (machine, request) => hubMcp.relay(machine, request),
    },
    log,
    heartbeatMs: LOCAL_HEARTBEAT_MS,
  })
  const token = await ownMachine({ hub, hubStore, db: ctx.db, machineDb, name: hostname() })
  own = token.machine

  // The process before this one may have kept a command its machine never took: nothing waits for its result now, and a
  // launch among them would start a session the chain did not ask for again.
  const stale = await hubStore.commandsAfter(own, 0)
  if (stale.length > 0) {
    await hubStore.dropCommands(own, stale.at(-1)!.seq)
    log(`machine: ${stale.length} command(s) the service kept before its restart are dropped: ${stale.map((command) => command.type).join(', ')}`)
  }
  await agree()

  const local = wireMachine(ctx, async (snapshot) => void (await end.emit(HANDOFF_EVENT, snapshot)))
  /** Kept for one computation of the facts, which asks per project: `projectOf` scans every project's tasks. */
  let pass: Map<string, string[]> | undefined
  const passOf = (): Map<string, string[]> => {
    if (pass !== undefined) return pass
    const running = new Map<string, string[]>()
    for (const task of ctx.monitor.tasks()) {
      const project = ctx.projectOf(task)
      if (project !== undefined) running.set(project, [...(running.get(project) ?? []), task])
    }
    return running
  }
  const moves = new MachineMoves({
    local,
    emit: (type, payload) => end.emit(type, payload),
    // The launch journal is the hub's record that the machine's outbox carries (`docs/machines.md`, "Journal").
    journal: (launched) => {
      const entry = ctx.withSource(launched)
      ctx.writes.add(`the launch of ${entry.task}`, records.launch(entry))
    },
    now: () => new Date(),
    log,
  })
  const ownRun = (project: string, task: string): boolean => !sameJson(ctx.choiceFor(project, task), ctx.choiceFor(project))
  const runner: MachineRunner = new MachineRunner({
    local,
    emit: (type, payload) => end.emit(type, payload),
    boot: randomUUID(),
    projects: () => Object.keys(ctx.configStore.current.projects),
    tasks: () => {
      const sessions = new Map<string, Set<string>>()
      const of = (task: string): Set<string> => sessions.get(task) ?? sessions.set(task, new Set()).get(task)!
      for (const task of ctx.monitor.tasks()) of(task)
      for (const agent of ctx.agents) if (agent.name !== undefined) of(agent.name)
      for (const view of ctx.sessions) of(view.task).add(view.sessionId)
      return [...sessions].map(([task, ids]) => ({ task, sessions: [...ids] }))
    },
    runs: (project) => {
      const listed = (ctx.tasksByProject.get(project) ?? []).map((task) => task.id)
      return [...new Set([...listed, ...(passOf().get(project) ?? [])])].filter((task) => ownRun(project, task))
    },
    reported: (project) => ctx.checkReports.tasks(project),
    model: (project, task) => ctx.choiceFor(project, task).model,
    accounts: () => ctx.homes.all().map((home) => home.key),
    limitsOf: (account) => ctx.limits.limits(account),
    ledger: () => ctx.ledger.accounts,
    sessions: () => ctx.sessions,
    mailbox: () => Object.fromEntries(ctx.sessions.flatMap((view): [string, SessionMail][] => {
      const mail = ctx.mailbox.of(view.sessionId)
      const steers = ctx.agents.some((agent) => agent.sessionId === view.sessionId && agent.steers === true)
      const listens = steers || ctx.mailbox.listens(view.sessionId)
      return listens || mail.length > 0 ? [[view.sessionId, { listens, steers, mail }]] : []
    })),
    // Read with the CLI copies the page shows, so it never sees a CLI as found there and missing here (BTN-639).
    panel: () => ({ ...ctx.account.view, missing: ctx.account.missingNow() }),
    usageOf: (account) => ctx.limits.usage(account),
    owners: () => {
      const owners: Record<string, string> = {}
      for (const { sessionId } of ctx.launches) {
        const key = ctx.owners.of(sessionId)
        if (key !== undefined) owners[sessionId] = key
      }
      for (const agent of ctx.agents) {
        const key = agent.account ?? ctx.owners.of(agent.sessionId)
        if (key !== undefined) owners[agent.sessionId] = key
      }
      return owners
    },
    compactions: () => ctx.monitor.compactionCounts(),
    moves,
    scope: (body) => ctx.account.batch(() => ctx.choiceFor.pass(() => {
      pass = passOf()
      try {
        return body()
      } finally {
        pass = undefined
      }
    })),
    log,
  })

  let online = (): void => {}
  const first = new Promise<void>((resolve) => (online = resolve))
  const end: MachineEnd = new MachineEnd({
    transport: new LocalTransport(hub, bearerOf(token)),
    store: machineStore,
    concurrent: true,
    snapshot: () => runner.snapshot(),
    command: (command) => runner.command(command),
    changed: () => {
      if (end.status().state === 'online') online()
    },
    log,
  })
  let publishing: ReturnType<typeof setInterval> | undefined
  const records = new MachineRecords((type, payload) => end.emit(type, payload))
  ctx.mailbox.persistWith(async (change) => {
    await records.mailbox(change)
    await runner.publish()
  })

  return {
    port: remote.port(),
    assignments,
    records,
    page: remote.page,
    start: async () => {
      await end.start()
      let waited: ReturnType<typeof setTimeout> | undefined
      await Promise.race([first, new Promise<void>((resolve) => (waited = setTimeout(resolve, FIRST_SNAPSHOT_MS)))])
      clearTimeout(waited)
      if (end.status().state !== 'online') log('machine: the own machine has not posted its first snapshot yet; the chains wait for it')
      // From here the servers holding keys are reached over the link, as from a machine of its own (BTN-990).
      ctx.packages.throughHub({ relay: (request) => end.mcp(request), tasks: machineTasks(ctx, end) })
      await end.flushed()
      // These readers were built before the link: replay may have added a launch, settled mail or kept a window.
      await ctx.mailbox.reload(ctx.db)
      ctx.monitor.restoreWindows(await loadSessionWindows(ctx.db))
      publishing = setInterval(() => void catchUp(), PUBLISH_EVERY_MS)
      publishing.unref()
    },
    close: async () => {
      clearInterval(publishing)
      await ctx.writes.settled()
      await end.flushed()
      end.stop()
      hub.stop()
      await machineDb.close()
    },
  }
}
