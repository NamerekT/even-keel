import { randomUUID } from 'node:crypto'
import { CLAUDE } from '../claude/name.js'
import { AccountIdentities } from '../limits/identity.js'
import { accountTie, type AccountTie } from '../limits/polls.js'
import { MachineEnd, type FolderMarks, type HubTransport } from '../link/machine.js'
import type { MachineStore } from '../link/machine-store.js'
import type { MachineAbout, VersionRefusal } from '../link/protocol.js'
import { sameJson } from '../machine/facts.js'
import { MachineMoves, type HeldMove } from '../machine/moves.js'
import { machineValue, setMachineValue } from '../machine/state.js'
import { MachineRecords } from '../machine/records.js'
import { HANDOFF_EVENT, LEFTOVER_EVENT, MachineRunner, TRANSCRIPT_EVENT } from '../machine/runner.js'
import type { SessionMail } from '../sessions/mail.js'
import { steers } from '../sessions/view-index.js'
import type { MachineContext } from './machine-context.js'
import { steer, wireMachine } from './machine-chain.js'
import { machineTasks } from './hub-mcp.js'
import { wireMachineChats } from './machine-chats.js'
import { wireMachineServices } from './machine-services.js'
import { CLONE_PROGRESS_EVENT, cloneTold } from '../machine/services.js'

export interface MachineSideOptions {
  transport: HubTransport
  store: MachineStore
  /** The marks of the folders it agrees to (`docs/machines.md`, "The folder's mark"). */
  marks?: FolderMarks
  /** What the machine tells of itself at each handshake: a machine on the network only. */
  about?: () => Promise<MachineAbout>
  /** The link's status changed. */
  changed?: (end: MachineEnd) => void
  /** The hub refused this machine's API version (BTN-1275): the machine may move itself to the hub's. */
  versionRefused?: (refusal: VersionRefusal) => void
  heartbeatMs?: number
  /**
   * A machine of its own (BTN-1226): while the link is down it follows and guards the tasks the hub gave it, and keeps
   * the hub's last word on them and the hub's brief in its database. The hub's own machine never loses its link.
   */
  alone?: boolean
  log: (line: string) => void
}

export interface MachineSide {
  end: MachineEnd
  runner: MachineRunner
  records: MachineRecords
  /** `start` before the link's: the moves held from before are read back, and the clock of the moves alone starts. */
  moves: MachineMoves
  /** Resolves once the link went online the first time. */
  online: Promise<void>
  /** From here the servers holding keys are reached over the link (BTN-990): once the first brief may have come. */
  throughHub(): void
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * The machine's end of the link (`docs/machines.md`): its port behind `MachineRunner`, talking to a hub through
 * `MachineEnd` over the transport given — a call in the hub's own process, HTTPS on a machine of its own (BTN-1247).
 * Nothing is connected until `end.start()`.
 */
export function wireMachineSide(machine: MachineContext, options: MachineSideOptions): MachineSide {
  const { log } = options
  const local = wireMachine(machine, async (snapshot) => void (await end.emit(HANDOFF_EVENT, snapshot)))
  /** Kept for one computation of the facts, which asks per project: `projectOf` scans every project's tasks. */
  let pass: Map<string, string[]> | undefined
  const passOf = (): Map<string, string[]> => {
    if (pass !== undefined) return pass
    const running = new Map<string, string[]>()
    for (const task of machine.monitor.tasks()) {
      const project = machine.projectOf(task)
      if (project !== undefined) running.set(project, [...(running.get(project) ?? []), task])
    }
    return running
  }
  const moves = new MachineMoves({
    local,
    emit: (type, payload) => end.emit(type, payload),
    // The launch journal is the hub's record that the machine's outbox carries (`docs/machines.md`, "Journal").
    journal: (entry) => machine.writes.add(`the launch of ${entry.task}`, records.launch(entry)),
    now: () => new Date(),
    log,
    ...(options.alone === true && {
      alone: {
        online: () => end.status().state === 'online',
        permits: (project, task) => {
          const { brief } = machine
          if (!brief.held) return true
          return brief.currentOf(task) === project && brief.active().some((chain) => chain.project === project && !chain.paused)
        },
        keep: {
          load: async () => ((await machineValue(machine.machineDb, 'moves.held')) as HeldMove[] | undefined) ?? [],
          save: (held) => machine.writes.add('the moves held', setMachineValue(machine.machineDb, 'moves.held', held)),
        },
      },
    }),
  })
  const identities = new AccountIdentities()
  const ownRun = (project: string, task: string): boolean => !sameJson(machine.choiceFor(project, task), machine.choiceFor(project))
  const runner: MachineRunner = new MachineRunner({
    local,
    emit: (type, payload) => end.emit(type, payload),
    boot: randomUUID(),
    projects: () => Object.keys(machine.configStore.current.projects),
    tasks: () => {
      const sessions = new Map<string, Set<string>>()
      const of = (task: string): Set<string> => sessions.get(task) ?? sessions.set(task, new Set()).get(task)!
      for (const task of machine.monitor.tasks()) of(task)
      for (const agent of machine.agents) if (agent.name !== undefined) of(agent.name)
      for (const view of machine.sessions) of(view.task).add(view.sessionId)
      return [...sessions].map(([task, ids]) => ({ task, sessions: [...ids] }))
    },
    runs: (project) => {
      const listed = machine.brief.tasksOf(project)
      return [...new Set([...listed, ...(passOf().get(project) ?? [])])].filter((task) => ownRun(project, task))
    },
    reported: (project) => machine.brief.reported(project),
    model: (project, task) => machine.choiceFor(project, task).model,
    accounts: () => machine.homes.all().map((home) => home.key),
    limitsOf: (account) => machine.limits.limits(account),
    ledger: () => machine.ledger.accounts,
    sessions: () => machine.sessions.map((view) => {
      const warm = machine.keepWarm.kept(view.sessionId, view.cache)
      return warm === null ? view : { ...view, warm }
    }),
    mailbox: () => Object.fromEntries(machine.sessions.flatMap((view): [string, SessionMail][] => {
      const mail = machine.mailbox.of(view.sessionId)
      const steered = steers(machine.agents, view.sessionId)
      const listens = steered || machine.mailbox.listens(view.sessionId)
      return listens || mail.length > 0 ? [[view.sessionId, { listens, steers: steered, mail }]] : []
    })),
    // Read with the CLI copies the page shows, so it never sees a CLI as found there and missing here (BTN-639).
    panel: () => ({ ...machine.account.view, missing: machine.account.missingNow() }),
    usageOf: (account) => machine.limits.usage(account),
    owners: () => {
      const owners: Record<string, string> = {}
      for (const { sessionId } of machine.journal) {
        const key = machine.owners.of(sessionId)
        if (key !== undefined) owners[sessionId] = key
      }
      for (const agent of machine.agents) {
        const key = agent.account ?? machine.owners.of(agent.sessionId)
        if (key !== undefined) owners[agent.sessionId] = key
      }
      return owners
    },
    compactions: () => machine.monitor.compactionCounts(),
    identities: () => {
      const ties: Record<string, AccountTie> = {}
      for (const home of machine.homes.all()) {
        if (home.agent !== CLAUDE) continue
        const signed = identities.of(machine.homes.configFile(home))
        const tie = accountTie(signed, machine.account.longToken(home.key)?.account, machine.limits.pollable(home.key), machine.limits.skipped(home.key))
        if (tie !== undefined) ties[home.key] = tie
      }
      return ties
    },
    limitsPlan: (plan) => machine.limits.plan(plan),
    brief: (brief) => {
      const first = !machine.brief.received
      const changed = !sameJson(brief, machine.brief.whole)
      machine.brief.take(brief)
      if (options.alone === true && changed) machine.writes.add('the hub brief', setMachineValue(machine.machineDb, 'brief.kept', brief))
      // The projects without git are known from the first brief on: what their folders have become is read then.
      if (first) void machine.gitFound.checkAll().catch((error: unknown) => log(`git: the projects without git were not read: ${messageOf(error)}`))
    },
    works: () => machine.works.view(),
    gitFound: () => machine.gitFound.view(),
    moves,
    services: wireMachineServices(machine, {
      steer: (task, session, prompt) => steer(machine, task, session, prompt),
      restore: async ({ launches, windows, mail }) => {
        records.restore(launches)
        machine.mailbox.restore(mail)
        machine.monitor.restoreWindows(windows)
      },
      cloneProgress: cloneTold((payload) => void end.emit(CLONE_PROGRESS_EVENT, payload).catch(() => {})),
      chats: wireMachineChats(machine),
    }),
    scope: (body) => machine.account.batch(() => machine.packages.pass(() => machine.choiceFor.pass(() => {
      pass = passOf()
      try {
        return body()
      } finally {
        pass = undefined
      }
    }))),
    log,
  })

  let wentOnline = (): void => {}
  const online = new Promise<void>((resolve) => (wentOnline = resolve))
  const end: MachineEnd = new MachineEnd({
    transport: options.transport,
    store: options.store,
    concurrent: true,
    snapshot: () => runner.snapshot(),
    command: (command) => runner.command(command),
    ...(options.about !== undefined && { about: options.about }),
    ...(options.marks !== undefined && { marks: options.marks }),
    ...(options.heartbeatMs !== undefined && { heartbeatMs: options.heartbeatMs }),
    ...(options.versionRefused !== undefined && { versionRefused: options.versionRefused }),
    changed: () => {
      if (end.status().state === 'online') wentOnline()
      options.changed?.(end)
    },
    log,
  })
  const records = new MachineRecords((type, payload) => end.emit(type, payload), machine.journal)
  machine.tell.connect({
    record: async (type, payload) => void await end.emit(type, payload),
    leftover: (project, task, notice) => void end.emit(LEFTOVER_EVENT, { project, task, notice }).catch((error: unknown) => log(`machine: what the cleanup left on ${task} was not told: ${messageOf(error)}`)),
    transcript: (sessionId) => void end.emit(TRANSCRIPT_EVENT, { sessionId }).catch(() => {}),
    changed: () => void runner.publish().catch(() => {}),
  })
  machine.mailbox.persistWith(async (change) => {
    await records.mailbox(change)
    await runner.publish()
  })

  return {
    end,
    runner,
    records,
    moves,
    online,
    throughHub: () => machine.packages.throughHub({ servers: () => machine.brief.hubServers(), relay: (request) => end.mcp(request), tasks: machineTasks(machine, end) }),
  }
}
