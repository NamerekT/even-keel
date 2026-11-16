import { vi } from 'vitest'
import type { AccountView } from '../account/model.js'
import type { LaunchEntry } from '../chain/model.js'
import type { HandoffSnapshot } from '../chain/snapshots.js'
import type { AccountTie, LimitsPlan } from '../limits/polls.js'
import type { UsageHealth } from '../limits/usage.js'
import { HubEnd } from '../link/hub.js'
import { FINGERPRINT, HUB_ADDRESS, MemoryHubStore, MemoryMachineStore, Wire } from '../link/link.fixture.js'
import { MachineEnd } from '../link/machine.js'
import { bearerOf, parseToken, type NumberedCommand } from '../link/protocol.js'
import { fail } from '../notice/notice.js'
import type { FoundRepository, SessionView, TaskWork } from '../state.js'
import type { HubBrief } from './brief.js'
import type { SessionMail } from '../sessions/mail.js'
import { Writes, type Db } from '../storage/database.js'
import { Assignments } from './assignments.js'
import { MachineMoves } from './moves.js'
import type { MachinePort } from './port.js'
import { RemoteMachine, type RemoteDeps } from './remote.js'
import { MachineRunner } from './runner.js'
import type { MachineServices } from './services.js'

export const PROJECT = '11111111-1111-4111-8111-111111111111'
export const REPO = 'C:/repos/example'
export const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

/** A machine whose sessions are a map: a launch waits at `gate`, then the task has a live session. */
export function machineOf() {
  const state = {
    live: {} as Record<string, string>,
    /** Tasks whose session stopped: the machine still knows them, by session id. */
    stopped: {} as Record<string, string>,
    launches: [] as string[],
    gate: Promise.resolve() as Promise<void>,
    read: true,
    refuseFinish: false,
    views: [] as SessionView[],
    mail: {} as Record<string, SessionMail>,
    panel: { active: 'main', accounts: [], login: null, loginBlock: null, apps: [], pool: [], missing: [] } as AccountView,
    usage: {} as Record<string, UsageHealth>,
    owners: {} as Record<string, string>,
    compactions: {} as Record<string, number>,
    identities: {} as Record<string, AccountTie>,
    plans: [] as LimitsPlan[],
    briefs: [] as HubBrief[],
    works: {} as Record<string, Record<string, TaskWork>>,
    gitFound: {} as Record<string, FoundRepository>,
  }
  const local = {
    launch: async (_project: string, task: string) => {
      state.launches.push(task)
      await state.gate
      state.live[task] = `session-${state.launches.length}`
      return { sessionId: state.live[task] }
    },
    finish: async (_project: string, task: string) => {
      if (state.refuseFinish) throw fail('slot.busyStart', { slot: `${REPO}/.claude/worktrees/example`, sessions: ['ABC-2 (session-9)'], task })
      delete state.live[task]
      return { warnings: [], syncError: null }
    },
    head: async () => null,
    changes: async () => ({ ahead: 0, files: [] }),
    liveSession: (task: string) => state.live[task],
    busy: (task: string) => task in state.live,
    midTurn: () => false,
    shell: () => false,
    asked: () => null,
    limited: () => undefined,
    handoff: (task: string) => (task in state.stopped ? { sessionId: state.stopped[task] } : undefined),
    sessionsRead: () => state.read,
    accountsRead: () => true,
    reportedTree: () => null,
    account: () => ({ id: 'main/john@example.com', ready: true }),
    launchBlock: () => undefined,
    limitReset: () => null,
    limitResetAfter: () => null,
    limitsUnread: () => undefined,
    packagesBlocked: () => false,
    packagesPause: () => undefined,
    trackerMissing: () => undefined,
  } as unknown as MachinePort
  return { state, local }
}

/** The hub and one machine over the link; the machine makes the moves of a task's session (`MachineMoves`). */
export async function bench(brief?: RemoteDeps['brief'], note?: RemoteDeps['note'], services?: MachineServices) {
  const hubStore = new MemoryHubStore()
  const machineStore = new MemoryMachineStore()
  await machineStore.agree(PROJECT, REPO)
  const log: string[] = []
  const snapshots: HandoffSnapshot[] = []
  const journal: LaunchEntry[] = []
  const { state, local } = machineOf()
  const queries: Array<{ sql: string; params: unknown[] }> = []
  const db = { query: async (sql: string, params: unknown[] = []) => (queries.push({ sql, params }), { rows: [] }) } as unknown as Db
  const assignments = await Assignments.open({ db, writes: new Writes((line) => log.push(line)), order: () => [] })
  queries.length = 0
  let id = ''
  const remote: RemoteMachine = new RemoteMachine({
    send: (machine, command) => hub.send(machine, command),
    machine: () => id,
    projectOf: () => PROJECT,
    projectOfSession: () => PROJECT,
    lastSession: () => undefined,
    ...(brief === undefined ? {} : { brief }),
    ...(note === undefined ? {} : { note }),
    saveSnapshot: (snapshot) => void snapshots.push(snapshot),
    assigned: (project, task) => assignments.assign(project, task, id),
    released: (project, task) => assignments.release(project, task),
    held: (named, live) => assignments.reconcile(id, named, live),
    log: (line) => log.push(line),
  })
  const hub: HubEnd = new HubEnd({ store: hubStore, handlers: remote.handlers(), log: (line) => log.push(line) })
  const token = parseToken(await hub.issue('Example server', HUB_ADDRESS, FINGERPRINT))!
  id = token.machine
  const wire = new Wire(hub, bearerOf(token))
  const ran: NumberedCommand[] = []
  /** The machine's process: a new one on the same store is the machine after a restart. */
  const boot = (name: string) => {
    const runner: MachineRunner = new MachineRunner({
      local,
      emit: (type, payload) => end.emit(type, payload),
      boot: name,
      projects: () => [PROJECT],
      tasks: () => Object.entries({ ...state.stopped, ...state.live }).map(([task, session]) => ({ task, sessions: [session] })),
      runs: () => [],
      reported: () => [],
      model: () => null,
      accounts: () => ['main'],
      limitsOf: () => null,
      ledger: () => ({}),
      sessions: () => state.views,
      mailbox: () => state.mail,
      panel: () => state.panel,
      usageOf: (account) => state.usage[account] ?? { state: 'waiting', reason: null, since: null },
      owners: () => state.owners,
      compactions: () => state.compactions,
      identities: () => state.identities,
      limitsPlan: (plan) => void state.plans.push(plan),
      brief: (brief) => void state.briefs.push(brief),
      works: () => state.works,
      gitFound: () => state.gitFound,
      moves: new MachineMoves({
        local,
        emit: (type, payload) => end.emit(type, payload),
        journal: (entry) => void journal.push(entry),
        now: () => new Date(),
        log: (line) => log.push(line),
      }),
      ...(services === undefined ? {} : { services }),
      log: (line) => log.push(line),
    })
    const end: MachineEnd = new MachineEnd({
      transport: wire,
      store: machineStore,
      host: 'example-host',
      concurrent: true,
      snapshot: () => runner.snapshot(),
      command: (command) => {
        ran.push(command)
        return runner.command(command)
      },
      log: (line) => log.push(line),
    })
    return { runner, end }
  }
  return { hub, hubStore, machineStore, wire, remote, port: remote.port(), state, local, log, snapshots, journal, ran, boot, id, assignments, queries }
}
