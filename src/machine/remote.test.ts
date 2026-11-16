import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountEntry, AccountView } from '../account/model.js'
import type { HandoffSnapshot } from '../chain/snapshots.js'
import type { UsageHealth } from '../limits/usage.js'
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
    panel: { active: 'main', accounts: [], login: null, loginBlock: null, apps: [], pool: [], missing: [] } as AccountView,
    usage: {} as Record<string, UsageHealth>,
    owners: {} as Record<string, string>,
    compactions: {} as Record<string, number>,
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
      panel: () => state.panel,
      usageOf: (account) => state.usage[account] ?? { state: 'waiting', reason: null, since: null },
      owners: () => state.owners,
      compactions: () => state.compactions,
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
    expect(remote.page.sessions()).toEqual(state.views)
    end.stop()
    state.views = [{ ...state.views[0]!, lamp: 'finished' }]
    await runner.publish()
    state.views = []
    await end.start()
    await tick()
    expect(remote.page.sessions()).toEqual([])
  })

  it('mirrors chat messages and delivery without sharing the machine objects', async () => {
    const { state, remote, runner } = await started()
    state.mail = { 'session-1': { listens: true, steers: false, mail: [{
      id: 1, task: 'ABC-1', sessionId: 'session-1', text: 'Continue.', files: [],
      postedAt: '2026-11-16T10:00:00.000Z', fate: 'waiting', event: null, reason: null, settledAt: null,
    }] } }
    await runner.publish()
    await tick()
    expect(remote.page.mailbox()).toEqual(state.mail)
    state.mail = { 'session-1': { ...state.mail['session-1']!, mail: [{
      ...state.mail['session-1']!.mail[0]!, fate: 'delivered', event: 'Stop', settledAt: '2026-11-16T10:00:01.000Z',
    }] } }
    expect(remote.page.mailbox()['session-1']!.mail[0]!.fate).toBe('waiting')
    await runner.publish()
    await tick()
    expect(remote.page.mailbox()).toEqual(state.mail)
    state.mail = {}
    await runner.publish()
    await tick()
    expect(remote.page.mailbox()).toEqual({})
  })

  it('gives the page the accounts and the sessions of the machine from the mirror, as fresh as its last post', async () => {
    const { state, remote, runner } = await started()
    const entry = { key: 'main', agent: 'claude', status: { loggedIn: true, email: 'john@example.com' } } as unknown as AccountEntry
    state.panel = { ...state.panel, accounts: [entry], missing: ['codex'] }
    state.usage = { main: { state: 'ok', reason: null, since: null } }
    state.owners = { 'session-old': 'main' }
    state.compactions = { 'session-old': 2 }
    state.views = [{ sessionId: 'session-1', task: 'ABC-1', lamp: 'working', account: 'jane@example.com', feed: [] } as unknown as SessionView]
    state.mail = { 'session-1': { listens: true, steers: true, mail: [] } }
    const page = remote.page
    expect(page.panel()?.accounts).toEqual([])
    await runner.publish()
    await tick()
    expect(page.panel()).toEqual(state.panel)
    expect(page.usage('main').state).toBe('ok')
    expect(page.usage('other').state).toBe('waiting')
    expect(page.hasAccount('claude', 'main')).toBe(true)
    expect(page.hasAccount('codex', 'main')).toBe(false)
    expect(page.sessionAccount('session-1', null)).toBe('jane@example.com')
    expect(page.sessionAccount('session-old', null)).toBe('john@example.com')
    expect(page.sessionAccount('session-unknown', null)).toBeNull()
    expect(page.compactionsOf('session-old')).toBe(2)
    expect(page.compactionsOf('session-1')).toBe(0)
    expect(page.liveView('ABC-1')?.sessionId).toBe('session-1')
    expect(page.steers('session-1')).toBe(true)
    state.panel = { ...state.panel, missing: [] }
    state.views = [{ ...state.views[0]!, lamp: 'finished' }]
    expect(page.panel()?.missing).toEqual(['codex'])
    await runner.publish()
    await tick()
    expect(page.panel()?.missing).toEqual([])
    expect(page.liveView('ABC-1')).toBeUndefined()
  })
})

describe('MachineRunner facts', () => {
  it('reads the local port inside one scope per snapshot and per post', async () => {
    const { state, local } = machineOf()
    let inside = false
    const outside: string[] = []
    const watched = new Proxy(local, {
      get(target, key, receiver) {
        const value: unknown = Reflect.get(target, key, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (!inside) outside.push(String(key))
          return (value as (...each: unknown[]) => unknown).apply(target, args)
        }
      },
    })
    const scopes = vi.fn(<T>(body: () => T): T => {
      inside = true
      try {
        return body()
      } finally {
        inside = false
      }
    })
    const runner = new MachineRunner({
      local: watched,
      emit: async () => undefined,
      boot: 'boot-1',
      projects: () => [PROJECT],
      tasks: () => Object.entries(state.live).map(([task, session]) => ({ task, sessions: [session] })),
      runs: () => ['ABC-1'],
      reported: () => [],
      model: () => null,
      accounts: () => ['main'],
      limitsOf: () => null,
      ledger: () => ({}),
      scope: scopes,
      log: () => {},
    })
    state.live['ABC-1'] = 'session-1'
    runner.snapshot()
    state.live['ABC-2'] = 'session-2'
    await runner.publish()
    expect(scopes).toHaveBeenCalledTimes(2)
    expect(outside).toEqual([])
  })

  it('reads once for the posts asked before it starts, and anew for a post asked while it runs', async () => {
    const { state, local } = machineOf()
    const scopes = vi.fn(<T>(body: () => T): T => body())
    const posted: unknown[] = []
    let release = (): void => {}
    let hold = false
    const runner = new MachineRunner({
      local,
      emit: async (_type, payload) => {
        posted.push(payload)
        if (hold) await new Promise<void>((resolve) => (release = resolve))
      },
      boot: 'boot-1',
      projects: () => [PROJECT],
      tasks: () => Object.entries(state.live).map(([task, session]) => ({ task, sessions: [session] })),
      runs: () => [],
      reported: () => [],
      model: () => null,
      accounts: () => ['main'],
      limitsOf: () => null,
      ledger: () => ({}),
      scope: scopes,
      log: () => {},
    })
    runner.snapshot()
    scopes.mockClear()

    state.live['ABC-1'] = 'session-1'
    await Promise.all([runner.publish(), runner.publish(), runner.publish()])
    expect(scopes).toHaveBeenCalledTimes(1)
    expect(posted).toHaveLength(1)

    hold = true
    state.live['ABC-2'] = 'session-2'
    const running = runner.publish()
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    // Asked while the post above runs: it must read what changed after that read began.
    state.live['ABC-3'] = 'session-3'
    const later = [runner.publish(), runner.publish()]
    hold = false
    release()
    await Promise.all([running, ...later])
    expect(scopes).toHaveBeenCalledTimes(3)
    expect(posted).toHaveLength(3)
    expect(posted[2]).toMatchObject({ patch: { tasks: { set: { 'ABC-3': { live: 'session-3' } } } } })
  })
})
