import type { HandoffSession } from '../chain/relay.js'
import { noticeOf } from '../notice/notice.js'
import type { MovesPort } from './move-call.js'
import type { MachinePort } from './port.js'

export interface PoolDeps {
  /** The installation's own machine: what a call with no machine of its own goes to. */
  own: () => string
  /** The port of a machine; `undefined` — no such machine now (revoked, or elsewhere and never connected). */
  port: (machine: string) => MachinePort | undefined
  /** The machine the task went to (`machine_tasks`); `undefined` — none. */
  machineOf: (project: string, task: string) => string | undefined
  projectOf: (task: string) => string | undefined
  /** The machine whose sessions have this one; `undefined` — none known. */
  sessionMachine: (sessionId: string) => string | undefined
  /** The machine a session works in this folder on; `undefined` — none known. */
  folderMachine: (folder: string) => string | undefined
}

/**
 * The chain's one port over every machine of the hub (BTN-993, `docs/machines.md`, "The pool"): a call about a task
 * goes to the machine the task went to (`machine_tasks`, written by the lane's `bind` before its launch), a call about a
 * session to the machine that has it, and the rest — the project's main, fix and carry sessions, the accounts' reads —
 * to the own machine. A machine gone falls back to the own one.
 */
export function machinePool(deps: PoolDeps): MachinePort {
  const hooked = new WeakSet<MachinePort>()
  let take: Parameters<MovesPort['onSaved']>[0] | undefined
  const at = (machine: string | undefined): MachinePort => {
    const port = (machine === undefined ? undefined : deps.port(machine)) ?? deps.port(deps.own())
    if (port === undefined) throw new Error(`no port of the own machine ${deps.own()}`)
    if (take !== undefined && !hooked.has(port)) {
      hooked.add(port)
      port.moves?.onSaved(take)
    }
    return port
  }
  const own = () => at(undefined)
  const idOf = (machine: string | undefined): string => (machine !== undefined && deps.port(machine) !== undefined ? machine : deps.own())
  const byTask = (project: string | undefined, task: string | undefined): MachinePort =>
    at(project === undefined || task === undefined ? undefined : deps.machineOf(project, task))
  const ofTask = (task: string): MachinePort => byTask(deps.projectOf(task), task)
  const ofSession = (session: HandoffSession): MachinePort => at(deps.sessionMachine(session.sessionId))
  const first = own()

  return {
    launch: (project, task, extra, brief) => byTask(project, task).launch(project, task, extra, brief),
    // The chain binds the fix to the machine it chose (BTN-995); unbound, it runs on the own one.
    launchFix: (project, name, report, reran) => byTask(project, name).launchFix(project, name, report, reran),
    launchCarry: (project, name, report) => own().launchCarry(project, name, report),
    resume: (task, session) => ofTask(task).resume(task, session),
    reply: (task, session, prompt, user) => ofTask(task).reply(task, session, prompt, user),
    relay: (task, session, prompt, reason, brief) => ofTask(task).relay(task, session, prompt, reason, brief),
    stop: (session) => ofSession(session).stop(session),
    locate: (session) => ofSession(session).locate(session),

    // The machine that cleaned up holds main's commits if its sync failed: its next try goes there (BTN-995).
    // One that went off the link mid-cleanup is such a sync too (`RemoteMachine.lost`).
    finish: async (project, task, pull) => {
      const machine = idOf(deps.machineOf(project, task))
      try {
        return { ...(await at(machine).finish(project, task, pull)), machine }
      } catch (error) {
        const failure = noticeOf(error)
        if (failure.code !== 'machine.lockLost') throw error
        return { warnings: [], syncError: failure, machine }
      }
    },
    sync: (project, machine) => at(machine).sync(project),
    prepare: (project, task) => byTask(project, task).prepare(project, task),
    checkMain: (project, task, commit) => byTask(project, task).checkMain(project, task, commit),
    runAfterGreen: (project, commit, forward) => own().runAfterGreen(project, commit, forward),
    head: (project, machine) => at(machine).head(project),
    tree: (project, commit, machine) => at(machine).tree(project, commit),
    merged: (project, task, local) => byTask(project, task).merged(project, task, local),
    carried: (project, commit) => own().carried(project, commit),
    ...(first.land === undefined
      ? {}
      : { land: (project: string, task: string, commit?: string) => byTask(project, task).land?.(project, task, commit) ?? Promise.resolve({ state: 'none' as const }) }),
    ...(first.forward === undefined
      ? {}
      : { forward: (project: string, commit: string, machine?: string) => at(machine).forward?.(project, commit) ?? Promise.resolve('offMain' as const) }),
    changes: (project, workdir) => at(deps.folderMachine(workdir)).changes(project, workdir),
    history: (project, commit, candidates) => own().history(project, commit, candidates),
    ...(first.modelBlock === undefined ? {} : { modelBlock: async (project: string, task: string) => byTask(project, task).modelBlock?.(project, task) }),

    liveSession: (task) => ofTask(task).liveSession(task),
    ...(first.lastSession === undefined ? {} : { lastSession: (project: string, task: string) => byTask(project, task).lastSession?.(project, task) }),
    busy: (task) => ofTask(task).busy(task),
    midTurn: (task) => ofTask(task).midTurn(task),
    shell: (task) => ofTask(task).shell(task),
    asked: (task) => ofTask(task).asked(task),
    ...(first.silentSince === undefined ? {} : { silentSince: (task: string) => ofTask(task).silentSince?.(task) ?? null }),
    limited: (task) => ofTask(task).limited(task),
    ...(first.overage === undefined ? {} : { overage: (task: string) => ofTask(task).overage?.(task) }),
    handoff: (task) => ofTask(task).handoff(task),
    ...(first.modelRefusal === undefined ? {} : { modelRefusal: (task: string, sessionId: string) => ofTask(task).modelRefusal?.(task, sessionId) }),
    // A task's machine with no port has posted no snapshot since the hub started: the own one's facts are not of it.
    sessionsRead: (task) => {
      if (task === undefined) return own().sessionsRead()
      const project = deps.projectOf(task)
      const machine = project === undefined ? undefined : deps.machineOf(project, task)
      if (machine !== undefined && deps.port(machine) === undefined) return false
      return at(machine).sessionsRead()
    },
    reportedTree: (project, task) => byTask(project, task).reportedTree(project, task),

    account: (project, task) => byTask(project, task).account(project, task),
    accountAt: (account, when) => own().accountAt(account, when),
    launchBlock: (project, task) => byTask(project, task).launchBlock(project, task),
    sessionBlock: (task) => ofTask(task).sessionBlock(task),
    limitReset: (project, task) => byTask(project, task).limitReset(project, task),
    ...(first.modelWeek === undefined ? {} : { modelWeek: (project: string, task?: string) => byTask(project, task).modelWeek?.(project, task) ?? null }),
    limitResetAfter: (account, when, text) => own().limitResetAfter(account, when, text),
    limitReopenedAt: (account, when, resetsAt, project, task) => byTask(project, task).limitReopenedAt(account, when, resetsAt, project, task),
    limitsUnread: (project, task) => byTask(project, task).limitsUnread(project, task),
    accountsRead: () => own().accountsRead(),
    // The lane's machine runs the session with its own tools: the own one's may be refused once off the pool.
    packagesBlocked: (project, task) => byTask(project, task).packagesBlocked(project, task),
    packagesHeld: (project, task) => {
      const machine = idOf(task === undefined ? undefined : deps.machineOf(project, task))
      const held = at(machine).packagesHeld?.(project, task)
      return held === undefined || machine === deps.own() ? held : { ...held, machine }
    },
    packagesPause: (project, task) => byTask(project, task).packagesPause(project, task),
    trackerMissing: (project) => own().trackerMissing(project),

    ...(first.catchUp === undefined ? {} : { catchUp: (whole?: boolean) => own().catchUp!(whole) }),
    ...(first.moves === undefined ? {} : {
      moves: {
        run: (name, move) => (byTask(move.project, move.task).moves ?? first.moves!).run(name, move),
        onSaved: (taken) => {
          take = taken
          own()
        },
      } satisfies MovesPort,
    }),
  }
}
