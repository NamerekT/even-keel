import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountEntry } from '../account/model.js'
import type { HandoffSnapshot } from '../chain/snapshots.js'
import { noticeOf } from '../notice/notice.js'
import type { FoundRepository, SessionView, TaskWork } from '../state.js'
import { emptyBrief } from './brief.js'
import { bench, machineOf, PROJECT, tick } from './remote.fixture.js'
import { DONE_EVENT, FACTS_EVENT, FRESH_MS, HANDOFF_EVENT, MachineRunner, SETTLE_MS } from './runner.js'
import { RemoteMachine } from './remote.js'

describe('the machine port over the link', () => {
  it('audits launches on the hub, including fixes, carries and a supplied launch brief', async () => {
    const send = vi.fn(async () => 1)
    const audit = vi.fn(async () => { throw new Error('audit failed') })
    const remote = new RemoteMachine({ send, audit, machine: () => 'example', projectOf: () => PROJECT, projectOfSession: () => PROJECT, lastSession: () => undefined, saveSnapshot: () => {}, log: () => {} })
    const port = remote.port()
    await expect(port.launch(PROJECT, 'ABC-1', undefined, { prompt: 'already prepared' })).rejects.toThrow('audit failed')
    await expect(port.launchFix(PROJECT, 'fix', {} as never)).rejects.toThrow('audit failed')
    await expect(port.launchCarry(PROJECT, 'carry', {} as never)).rejects.toThrow('audit failed')
    expect(audit).toHaveBeenCalledTimes(3)
    expect(send).not.toHaveBeenCalled()
  })

  it("hands the machine the hub's brief before a command that reads the task's run, never before the rest (BTN-1514)", async () => {
    const sent: string[] = []
    const send = vi.fn(async (_machine: string, command: { type: string }) => sent.push(command.type))
    let release = (): void => {}
    const briefNow = vi.fn(() => new Promise<void>((resolve) => (release = () => { sent.push('brief'); resolve() })))
    const remote = new RemoteMachine({ send, briefNow, machine: () => 'example', projectOf: () => PROJECT, projectOfSession: () => PROJECT, lastSession: () => undefined, saveSnapshot: () => {}, log: () => {} })
    const port = remote.port()
    const flush = async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
    }
    void port.launch(PROJECT, 'ABC-1', undefined, { prompt: 'already prepared' })
    await flush()
    expect(send).not.toHaveBeenCalled()
    release()
    await flush()
    void port.head(PROJECT)
    await flush()
    expect(sent).toEqual(['brief', 'port.launch', 'port.head'])
    expect(briefNow).toHaveBeenCalledTimes(1)
  })

  it('lets go of a cleanup and a sync of main when the machine goes off the link, and keeps waiting for the rest (BTN-995)', async () => {
    let seq = 0
    const remote = new RemoteMachine({ send: async () => ++seq, machine: () => 'example', projectOf: () => PROJECT, projectOfSession: () => PROJECT, lastSession: () => undefined, saveSnapshot: () => {}, log: () => {} })
    const port = remote.port()
    const finished = port.finish(PROJECT, 'ABC-1').then(() => undefined, (error: unknown) => noticeOf(error))
    const synced = port.sync(PROJECT).then(() => undefined, (error: unknown) => noticeOf(error))
    let head: unknown = 'waiting'
    void port.head(PROJECT).then((value) => (head = value), () => (head = 'failed'))
    await Promise.resolve()
    remote.lost()
    expect(await finished).toEqual({ code: 'machine.lockLost', params: { command: 'port.finish' } })
    expect(await synced).toEqual({ code: 'machine.lockLost', params: { command: 'port.sync' } })
    await Promise.resolve()
    expect(head).toBe('waiting')
  })

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

  it('prepares the brief on the hub and carries it as the fourth launch argument', async () => {
    const brief = { prompt: '\nTask text\n', task: { title: 'Example', description: 'Task text' } }
    const prepare = vi.fn(async () => brief)
    const made = await bench(prepare)
    const machine = made.boot('brief')
    stop.push(() => made.hub.stop(), () => machine.end.stop())
    await machine.end.start()
    await tick()
    const launched = made.port.launch(PROJECT, 'ABC-1')
    await tick()
    await launched
    expect(prepare).toHaveBeenCalledExactlyOnceWith(PROJECT, 'ABC-1')
    expect(made.ran[0]?.payload).toEqual({ args: [PROJECT, 'ABC-1', null, brief] })
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

  it('squares the tasks of the machine with its snapshot: a row of a task it no longer knows goes, a live session gets one', async () => {
    const { id, assignments, queries, state, end, log } = await started()
    end.stop()
    assignments.assign(PROJECT, 'ABC-1', id)
    assignments.assign(PROJECT, 'ABC-2', id)
    assignments.assign(PROJECT, 'ABC-3', 'another-machine')
    state.stopped['ABC-2'] = 'session-2'
    state.live['ABC-3'] = 'session-3'
    state.live['ABC-4'] = 'session-4'
    queries.length = 0
    await end.start()
    await tick()
    expect(assignments.machineOf(PROJECT, 'ABC-1')).toBeUndefined()
    expect(assignments.machineOf(PROJECT, 'ABC-2')).toBe(id)
    expect(assignments.machineOf(PROJECT, 'ABC-3')).toBe(id)
    expect(assignments.machineOf(PROJECT, 'ABC-4')).toBe(id)
    expect(queries.map(({ sql, params }) => [sql.split(' ')[0], params[1]])).toEqual([['delete', 'ABC-1'], ['insert', 'ABC-3'], ['insert', 'ABC-4']])
    expect(log.filter((line) => line.includes('machine_tasks'))).toEqual([
      `machine: ABC-1 is no longer on machine ${id}, its row in machine_tasks is removed`,
      `machine: ABC-3 has a live session on machine ${id} and was another-machine's in machine_tasks, it is ${id}'s now`,
      `machine: ABC-4 has a live session on machine ${id} and no row in machine_tasks, it is added`,
    ])
  })

  it('leaves a task moved off the machine where it went, though the machine comes back with a live session of it (BTN-1270)', async () => {
    const { id, assignments, moved, state, end, log } = await started()
    end.stop()
    assignments.assign(PROJECT, 'ABC-5', 'another-machine')
    moved.set('ABC-5', id)
    state.live['ABC-5'] = 'session-5'
    await end.start()
    await tick()
    expect(assignments.machineOf(PROJECT, 'ABC-5')).toBe('another-machine')
    expect(log).toContain(`machine: ABC-5 has a live session on machine ${id}, but was moved off it by hand: the chain goes on with it elsewhere and leaves that session alone`)
  })

  it('squares the tasks only once the machine has read its sessions', async () => {
    const { id, assignments, state, end, runner } = await started()
    end.stop()
    assignments.assign(PROJECT, 'ABC-1', id)
    state.read = false
    await end.start()
    await tick()
    expect(assignments.machineOf(PROJECT, 'ABC-1')).toBe(id)
    state.read = true
    await runner.publish()
    await tick()
    expect(assignments.machineOf(PROJECT, 'ABC-1')).toBeUndefined()
    // Between connections the record follows the launches and the cleanups, not the facts.
    assignments.assign(PROJECT, 'ABC-1', id)
    state.live['ABC-5'] = 'session-5'
    await runner.publish()
    await tick()
    expect(assignments.machineOf(PROJECT, 'ABC-1')).toBe(id)
    expect(assignments.machineOf(PROJECT, 'ABC-5')).toBeUndefined()
  })

  it('gives the notice a command threw on the machine, by its code', async () => {
    const { port, state } = await started()
    state.refuseFinish = true
    const failure = port.finish(PROJECT, 'ABC-1').then(() => undefined, (error: unknown) => noticeOf(error))
    await tick()
    expect((await failure)?.code).toBe('slot.busyStart')
  })

  it('pauses on a project whose folder another machine holds, by that machine', async () => {
    const { port, end, machineStore } = await started()
    await machineStore.withdraw(PROJECT)
    end.hold(PROJECT, { machine: 'machine-other', name: 'Example desktop' })
    const refused = port.sync(PROJECT).then(() => undefined, (error: unknown) => noticeOf(error))
    await tick()
    expect(await refused).toEqual({ code: 'machines.folderTaken', params: { name: 'Example desktop', owner: 'machine-other' } })
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

  it("tells the hub what holds the machine's packages, and nothing once they are ready (BTN-1524)", async () => {
    const { state, port, runner } = await started()
    state.held = { packages: [{ name: 'docs', problems: [{ kind: 'noResponse', servers: ['docs'] }] }] }
    await runner.publish()
    await tick()
    expect(port.packagesBlocked(PROJECT)).toBe(true)
    expect(port.packagesHeld!(PROJECT)).toEqual(state.held)
    state.held = undefined
    await runner.publish()
    await tick()
    expect(port.packagesHeld!(PROJECT)).toBeUndefined()
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

  it('mirrors whose account each folder is, and hands the machine the hub limits plan (BTN-991)', async () => {
    const { state, remote, runner } = await started()
    state.identities = { main: { account: 'account-1', email: 'john@example.com', polls: true } }
    await runner.publish()
    await tick()
    expect(remote.facts()?.identities).toEqual(state.identities)
    const plan = { skip: ['main'] }
    const told = remote.tellLimits(plan)
    await tick()
    await told
    expect(state.plans).toEqual([plan])
  })

  it('hands the machine the hub brief, and mirrors the task folders and the repositories found (BTN-1246)', async () => {
    const { state, remote, runner } = await started()
    const brief = { ...emptyBrief(), unattended: true, tasks: { [PROJECT]: ['ABC-1'] } }
    const told = remote.tellBrief(brief)
    await tick()
    await told
    expect(state.briefs).toEqual([brief])
    state.works = { [PROJECT]: { 'ABC-1': { ahead: 2 } as unknown as TaskWork } }
    state.gitFound = { other: { url: 'https://example.com/repo.git' } as unknown as FoundRepository }
    await runner.publish()
    await tick()
    expect(remote.page.works()).toEqual(state.works)
    expect(remote.page.gitFound()).toEqual(state.gitFound)
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

describe('MachineRunner reads (BTN-1475)', () => {
  const runnerOf = (services?: ConstructorParameters<typeof MachineRunner>[0]['services']) => {
    const { state, local } = machineOf()
    const scopes = vi.fn(<T>(body: () => T): T => body())
    const emitted: Array<[string, unknown]> = []
    const runner = new MachineRunner({
      local,
      emit: async (type, payload) => void emitted.push([type, payload]),
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
      ...(services !== undefined && { services }),
      log: () => {},
    })
    runner.snapshot()
    scopes.mockClear()
    return { state, runner, scopes, emitted }
  }

  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('gathers the changes told within the settle window into one read and one post', async () => {
    const { state, runner, scopes, emitted } = runnerOf()
    state.live['ABC-1'] = 'session-1'
    runner.changed()
    state.live['ABC-2'] = 'session-2'
    runner.changed()
    runner.changed()
    expect(scopes).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(scopes).toHaveBeenCalledTimes(1)
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject([FACTS_EVENT, { patch: { tasks: { set: { 'ABC-1': { live: 'session-1' }, 'ABC-2': { live: 'session-2' } } } } }])
  })

  it('reads at once for a post asked outright, and the settle window then has nothing left to read', async () => {
    const { state, runner, scopes } = runnerOf()
    state.live['ABC-1'] = 'session-1'
    runner.changed()
    await runner.publish()
    expect(scopes).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2)
    expect(scopes).toHaveBeenCalledTimes(1)
  })

  it('reads for a catch-up only after a change told or once the last read is older than FRESH_MS', async () => {
    const { state, runner, scopes } = runnerOf()
    await runner.refresh()
    await runner.refresh()
    expect(scopes).not.toHaveBeenCalled()
    state.live['ABC-1'] = 'session-1'
    runner.changed()
    await runner.refresh()
    expect(scopes).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FRESH_MS)
    await runner.refresh()
    expect(scopes).toHaveBeenCalledTimes(2)
  })

  it('posts the facts before the result of a command, and before a query only when a change was told since the last read', async () => {
    const record = vi.fn(async () => ({ sessionId: 'session-1' }))
    const services = { transcript: { record } } as unknown as NonNullable<ConstructorParameters<typeof MachineRunner>[0]['services']>
    const { state, runner, scopes, emitted } = runnerOf(services)
    await runner.command({ seq: 1, type: 'transcript.record', payload: { args: ['session-1'] } })
    expect(scopes).not.toHaveBeenCalled()
    expect(emitted.map(([type]) => type)).toEqual([DONE_EVENT])

    state.live['ABC-1'] = 'session-1'
    runner.changed()
    await runner.command({ seq: 2, type: 'port.head', payload: { args: [PROJECT] } })
    expect(scopes).toHaveBeenCalledTimes(1)
    expect(emitted.map(([type]) => type)).toEqual([DONE_EVENT, FACTS_EVENT, DONE_EVENT])

    await runner.command({ seq: 3, type: 'port.launch', payload: { args: [PROJECT, 'ABC-2'] } })
    expect(scopes).toHaveBeenCalledTimes(2)
  })
})
