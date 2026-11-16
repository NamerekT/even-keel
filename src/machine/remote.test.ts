import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandoffSnapshot } from '../chain/snapshots.js'
import { HubEnd } from '../link/hub.js'
import { FINGERPRINT, HUB_ADDRESS, MemoryHubStore, MemoryMachineStore, Wire } from '../link/link.fixture.js'
import { MachineEnd } from '../link/machine.js'
import { bearerOf, parseToken, type NumberedCommand } from '../link/protocol.js'
import { fail, noticeOf } from '../notice/notice.js'
import type { SessionView } from '../state.js'
import type { SessionMail } from '../sessions/mail.js'
import type { MachinePort } from './port.js'
import { RemoteMachine } from './remote.js'
import { HANDOFF_EVENT, MachineRunner } from './runner.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const REPO = 'C:/repos/example'
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

/** A machine whose sessions are a map: a launch waits at `gate`, then the task has a live session. */
function machineOf() {
  const state = {
    live: {} as Record<string, string>,
    launches: [] as string[],
    gate: Promise.resolve() as Promise<void>,
    read: true,
    refuseFinish: false,
    views: [] as SessionView[],
    mail: {} as Record<string, SessionMail>,
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
    handoff: () => undefined,
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

async function bench() {
  const hubStore = new MemoryHubStore()
  const machineStore = new MemoryMachineStore()
  await machineStore.agree(PROJECT, REPO)
  const log: string[] = []
  const snapshots: HandoffSnapshot[] = []
  const { state, local } = machineOf()
  let id = ''
  const remote: RemoteMachine = new RemoteMachine({
    send: (machine, command) => hub.send(machine, command),
    machine: () => id,
    projectOf: () => PROJECT,
    projectOfSession: () => PROJECT,
    lastSession: () => undefined,
    saveSnapshot: (snapshot) => void snapshots.push(snapshot),
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
      tasks: () => Object.entries(state.live).map(([task, session]) => ({ task, sessions: [session] })),
      runs: () => [],
      reported: () => [],
      model: () => null,
      accounts: () => ['main'],
      limitsOf: () => null,
      ledger: () => ({}),
      sessions: () => state.views,
      mailbox: () => state.mail,
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
  return { hub, hubStore, machineStore, wire, remote, port: remote.port(), state, log, snapshots, ran, boot, id }
}

describe('the machine port over the link', () => {
  let stop: Array<() => void> = []

  const started = async () => {
    const made = await bench()
    const machine = made.boot('first')
    stop.push(() => machine.end.stop(), () => made.hub.stop())
    await machine.end.start()
    await tick()
    return { ...made, ...machine }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    for (const each of stop) each()
    stop = []
    vi.useRealTimers()
  })

  it('reads nothing before the first snapshot of the machine, so the chain does not step', async () => {
    const made = await bench()
    stop.push(() => made.hub.stop())
    expect(made.port.sessionsRead()).toBe(false)
    expect(made.port.accountsRead()).toBe(false)
    expect(made.port.account(PROJECT)).toEqual({ id: null, ready: false })
    const { end } = made.boot('first')
    stop.push(() => end.stop())
    await end.start()
    await tick()
    expect(made.port.sessionsRead()).toBe(true)
    expect(made.port.account(PROJECT)).toEqual({ id: 'main/john@example.com', ready: true })
  })

  it('waits for the result of a launch, and the mirror already has the session when it comes', async () => {
    const { port, ran } = await started()
    const launched = port.launch(PROJECT, 'ABC-1')
    await tick()
    expect(await launched).toEqual({ sessionId: 'session-1' })
    expect(ran.map((command) => [command.type, command.project, command.payload])).toEqual([['port.launch', PROJECT, { args: [PROJECT, 'ABC-1'] }]])
    expect(port.liveSession('ABC-1')).toBe('session-1')
    expect(port.busy('ABC-1')).toBe(true)
  })

  it('answers a query while a launch before it still runs', async () => {
    const { port, state } = await started()
    let open = () => {}
    state.gate = new Promise((resolve) => (open = resolve))
    const launched = port.launch(PROJECT, 'ABC-1')
    await tick()
    const head = port.head(PROJECT)
    await tick()
    expect(await head).toBeNull()
    expect(port.liveSession('ABC-1')).toBeUndefined()
    open()
    await tick()
    expect(await launched).toEqual({ sessionId: 'session-1' })
  })

  it('gets the result of a launch after a break between the command and its result', async () => {
    const { port, state, wire } = await started()
    let open = () => {}
    state.gate = new Promise((resolve) => (open = resolve))
    let result: unknown
    void port.launch(PROJECT, 'ABC-1').then((value) => (result = value))
    await tick()
    expect(state.launches).toEqual(['ABC-1'])
    wire.cut()
    open()
    await tick()
    expect(result).toBeUndefined()
    await tick(1_000)
    expect(result).toEqual({ sessionId: 'session-1' })
    expect(state.launches).toEqual(['ABC-1'])
    expect(port.liveSession('ABC-1')).toBe('session-1')
  })

  it('starts no second session when the launch command comes again', async () => {
    const { port, state, wire, ran } = await started()
    const launched = port.launch(PROJECT, 'ABC-1')
    await tick()
    await launched
    wire.replay({ kind: 'command', command: ran[0]! })
    await tick()
    expect(state.launches).toEqual(['ABC-1'])
  })

  it('pauses on a launch the machine stopped in the middle of, without starting it again', async () => {
    const { port, state, end, boot } = await started()
    state.gate = new Promise(() => {})
    const launched = port.launch(PROJECT, 'ABC-1')
    const failure = launched.then(() => undefined, (error: unknown) => noticeOf(error))
    await tick()
    expect(state.launches).toEqual(['ABC-1'])
    end.stop()
    const again = boot('second')
    stop.push(() => again.end.stop())
    await again.end.start()
    await tick()
    expect(await failure).toEqual({ code: 'machine.commandInterrupted', params: { command: 'port.launch' } })
    expect(state.launches).toEqual(['ABC-1'])
  })

  it('takes the snapshot of a new connection over the facts posted before it and the ones lost', async () => {
    const { port, state, end, runner, machineStore } = await started()
    end.stop()
    state.live['ABC-1'] = 'session-1'
    await runner.publish()
    // The post of the session is lost with the outbox; an older one about another task is still kept.
    machineStore.outbox = []
    state.live['ABC-2'] = 'session-2'
    await runner.publish()
    delete state.live['ABC-2']
    await end.start()
    await tick()
    expect(port.liveSession('ABC-1')).toBe('session-1')
    expect(port.liveSession('ABC-2')).toBeUndefined()
    state.live['ABC-3'] = 'session-3'
    await runner.publish()
    await tick()
    expect(port.liveSession('ABC-3')).toBe('session-3')
  })

  it('gives the notice a command threw on the machine, by its code', async () => {
    const { port, state } = await started()
    state.refuseFinish = true
    const failure = port.finish(PROJECT, 'ABC-1').then(() => undefined, (error: unknown) => noticeOf(error))
    await tick()
    expect((await failure)?.code).toBe('slot.busyStart')
  })

  it('pauses on a command the machine refuses or cannot run', async () => {
    const { port, hub, remote, id } = await started()
    const refused = port.changes(PROJECT, 'C:/elsewhere').then(() => undefined, (error: unknown) => noticeOf(error))
    await tick()
    expect(await refused).toEqual({ code: 'machine.commandRefused', params: { command: 'port.changes', reason: 'folder' } })
    const failed = port.sync(PROJECT).then(() => undefined, (error: unknown) => noticeOf(error))
    await tick()
    expect((await failed)?.code).toBe('machine.commandFailed')
    // A result nobody waits for — the hub restarted since — is only logged.
    await hub.send(id, { type: 'port.head', project: PROJECT, payload: { args: [PROJECT] } })
    await tick()
    expect(remote.facts()?.sessionsRead).toBe(true)
  })

  it('keeps the handoff snapshot the machine sends', async () => {
    const { end, snapshots } = await started()
    const snapshot: HandoffSnapshot = { at: '2026-11-16T10:00:00.000Z', task: 'ABC-1', sessionId: 'session-2', previous: 'session-1', reason: 'relay', prompt: 'Go on.', notePath: null, note: null }
    await end.emit(HANDOFF_EVENT, snapshot)
    await tick()
    expect(snapshots).toEqual([snapshot])
  })

  it('mirrors session changes and removals, and reconnect replaces stale views', async () => {
    const { state, remote, runner, end } = await started()
    state.views = [{ sessionId: 'session-1', task: 'ABC-1', lamp: 'working', feed: [] } as unknown as SessionView]
    await runner.publish()
    await tick()
    expect(remote.sessions()).toEqual(state.views)
    end.stop()
    state.views = [{ ...state.views[0]!, lamp: 'finished' }]
    await runner.publish()
    state.views = []
    await end.start()
    await tick()
    expect(remote.sessions()).toEqual([])
  })

  it('mirrors chat messages and delivery without sharing the machine objects', async () => {
    const { state, remote, runner } = await started()
    state.mail = { 'session-1': { listens: true, steers: false, mail: [{
      id: 1, task: 'ABC-1', sessionId: 'session-1', text: 'Continue.', files: [],
      postedAt: '2026-11-16T10:00:00.000Z', fate: 'waiting', event: null, reason: null, settledAt: null,
    }] } }
    await runner.publish()
    await tick()
    expect(remote.mailbox()).toEqual(state.mail)
    state.mail = { 'session-1': { ...state.mail['session-1']!, mail: [{
      ...state.mail['session-1']!.mail[0]!, fate: 'delivered', event: 'Stop', settledAt: '2026-11-16T10:00:01.000Z',
    }] } }
    expect(remote.mailbox()['session-1']!.mail[0]!.fate).toBe('waiting')
    await runner.publish()
    await tick()
    expect(remote.mailbox()).toEqual(state.mail)
    state.mail = {}
    await runner.publish()
    await tick()
    expect(remote.mailbox()).toEqual({})
  })
})
