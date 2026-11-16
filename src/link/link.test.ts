import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bench } from './link.fixture.js'
import type { MachineEnd } from './machine.js'
import { API_VERSION, FAILED_EVENT, HEARTBEAT_MS, INTERRUPTED_EVENT, REFUSED_EVENT, encodeToken, parseToken } from './protocol.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

describe('the hub ↔ machine link', () => {
  let running: MachineEnd[] = []
  let stopHub: (() => void) | undefined

  const started = async (options: Parameters<Awaited<ReturnType<typeof bench>>['machine']>[0] = {}) => {
    const made = await bench()
    stopHub = () => made.hub.stop()
    const machine = made.machine(options)
    running.push(machine)
    await machine.start()
    await tick()
    return { ...made, end: machine, id: made.token.machine }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    for (const machine of running) machine.stop()
    running = []
    stopHub?.()
    vi.useRealTimers()
  })

  it('shakes hands, posts the snapshot first and is online', async () => {
    const { wire, end, snapshots, presence, hubStore, id } = await started()
    expect(wire.opens.map((open) => open.hello)).toEqual([{ api: API_VERSION, host: 'example-host', lastCommand: 0 }])
    expect(wire.posts[0]?.kind).toBe('snapshot')
    expect(snapshots).toEqual([{ sessions: [] }])
    expect(end.status()).toEqual({ state: 'online' })
    expect(presence).toEqual(['online'])
    expect(hubStore.machines.get(id)?.host).toBe('example-host')
  })

  it('carries a request to an MCP server of the hub and its answer', async () => {
    const { end, asked, id } = await started()
    const answer = await end.mcp({ path: '/tasks/example', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(answer).toEqual({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"echo":"/tasks/example"}' })
    expect(asked).toEqual([{ machine: id, request: { path: '/tasks/example', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } }])
  })

  it('has no answer of the hub for an MCP request while the hub is away, and stays connected after a lost one', async () => {
    const { end, wire, asked } = await started()
    const request = { path: '/tasks', method: 'POST', headers: {}, body: '{}' }
    wire.loseAnswers = true
    expect(await end.mcp(request)).toBeUndefined()
    wire.loseAnswers = false
    expect(end.status().state).toBe('online')
    end.stop()
    expect(await end.mcp(request)).toBeUndefined()
    expect(asked).toHaveLength(1)
  })

  it('numbers the commands per machine and runs them in order', async () => {
    const { hub, id, ran, hubStore } = await started()
    expect(await hub.send(id, { type: 'example.first' })).toBe(1)
    expect(await hub.send(id, { type: 'example.second' })).toBe(2)
    expect(await hub.send(id, { type: 'example.third' })).toBe(3)
    await tick()
    expect(ran.map((command) => [command.seq, command.type])).toEqual([[1, 'example.first'], [2, 'example.second'], [3, 'example.third']])
    // The machine named them as taken, so the hub keeps them no longer.
    expect(hubStore.commands.get(id)).toEqual([])
  })

  it('numbers the events of the machine and the hub takes each once', async () => {
    const { end, taken, machineStore } = await started()
    expect(await end.emit('example.started', { task: 'ABC-1' })).toBe(1)
    expect(await end.emit('example.idle')).toBe(2)
    await tick()
    expect(taken.map((event) => [event.seq, event.type])).toEqual([[1, 'example.started'], [2, 'example.idle']])
    expect(machineStore.outbox).toEqual([])
  })

  it('keeps a command for a machine that is away and sends it at the next connection', async () => {
    const made = await bench()
    stopHub = () => made.hub.stop()
    expect(await made.hub.send(made.token.machine, { type: 'example.first' })).toBe(1)
    const machine = made.machine()
    running.push(machine)
    await machine.start()
    await tick()
    expect(made.ran.map((command) => command.seq)).toEqual([1])
  })

  it('sends again a command lost on the way, and the machine runs it once', async () => {
    const { hub, id, ran, wire } = await started()
    wire.mute = true
    await hub.send(id, { type: 'example.lost' })
    await tick()
    expect(ran).toEqual([])
    wire.mute = false
    wire.cut()
    await tick(1_000)
    expect(wire.opens).toHaveLength(2)
    expect(ran.map((command) => command.seq)).toEqual([1])
    wire.replay({ kind: 'command', command: { seq: 1, type: 'example.lost' } })
    await tick()
    expect(ran).toHaveLength(1)
  })

  it('does not run a command again after a restart of the machine', async () => {
    const made = await started()
    await made.hub.send(made.id, { type: 'example.once' })
    await tick()
    made.end.stop()
    const again = made.machine()
    running.push(again)
    await again.start()
    await tick()
    expect(made.wire.opens.at(-1)?.hello.lastCommand).toBe(1)
    made.wire.replay({ kind: 'command', command: { seq: 1, type: 'example.once' } })
    await tick()
    expect(made.ran).toHaveLength(1)
  })

  it('keeps the events while the hub is away and sends them in order after the snapshot', async () => {
    const { wire, end, taken } = await started()
    wire.down = true
    wire.cut()
    await tick()
    await end.emit('example.one')
    await end.emit('example.two')
    await end.emit('example.three')
    expect(end.status().state).toBe('offline')
    wire.down = false
    const before = wire.posts.length
    await tick(1_000)
    expect(wire.posts.slice(before).map((entry) => entry.kind)).toEqual(['snapshot', 'events'])
    expect(taken.map((event) => event.seq)).toEqual([1, 2, 3])
  })

  it('drops the events the hub has taken when the answer was lost', async () => {
    const { wire, end, taken, machineStore } = await started()
    wire.loseAnswers = true
    await end.emit('example.one')
    await tick()
    expect(taken.map((event) => event.seq)).toEqual([1])
    expect(machineStore.outbox).toHaveLength(1)
    wire.loseAnswers = false
    await tick(1_000)
    await end.emit('example.two')
    await tick()
    expect(taken.map((event) => event.seq)).toEqual([1, 2])
    expect(machineStore.outbox).toEqual([])
  })

  it('takes an event that comes twice only once', async () => {
    const made = await bench()
    stopHub = () => made.hub.stop()
    const authorization = made.wire.authorization
    const opened = await made.hub.open(authorization, { api: API_VERSION, host: 'example-host', lastCommand: 0 }, { send: () => {}, close: () => {} })
    if ('refused' in opened) throw new Error('refused')
    const event = (seq: number) => ({ seq, type: 'example.event', at: seq })
    const post = (seqs: number[]) => made.hub.events(authorization, { connection: opened.connection, events: seqs.map(event), lastCommand: 0 })
    await expect(post([1, 2])).resolves.toEqual({ lastEvent: 2 })
    await expect(post([1, 2, 3])).resolves.toEqual({ lastEvent: 3 })
    await expect(post([2])).resolves.toEqual({ lastEvent: 3 })
    expect(made.taken.map((taken) => taken.seq)).toEqual([1, 2, 3])
  })

  it('brings an event again when the hub could not take it', async () => {
    const { end, taken, refuseEvents, wire } = await started()
    refuseEvents.on = true
    await end.emit('example.one')
    await end.emit('example.two')
    await tick()
    expect(taken).toEqual([])
    refuseEvents.on = false
    await tick(HEARTBEAT_MS)
    expect(taken.map((event) => event.seq)).toEqual([1, 2])
    expect(wire.opens).toHaveLength(1)
  })

  it('posts the snapshot first after every reconnect', async () => {
    const { wire, snapshots } = await started()
    for (const round of [2, 3]) {
      const before = wire.posts.length
      wire.cut()
      await tick(1_000)
      expect(wire.opens).toHaveLength(round)
      expect(wire.posts[before]?.kind).toBe('snapshot')
      expect(snapshots).toHaveLength(round)
    }
  })

  it('waits 1, 2, 4 … 30 s between the attempts and starts over after a handshake', async () => {
    const made = await bench()
    stopHub = () => made.hub.stop()
    made.wire.down = true
    const machine = made.machine()
    running.push(machine)
    const from = Date.now()
    await machine.start()
    await tick(125_000)
    expect(made.wire.opens.map((open) => (open.at - from) / 1_000)).toEqual([0, 1, 3, 7, 15, 31, 61, 91, 121])
    made.wire.down = false
    await tick(30_000)
    expect(machine.status()).toEqual({ state: 'online' })
    const count = made.wire.opens.length
    made.wire.cut()
    await tick(1_000)
    expect(made.wire.opens).toHaveLength(count + 1)
  })

  it('stays connected while the pulse goes both ways', async () => {
    const { wire, end, presence } = await started()
    await tick(HEARTBEAT_MS * 15)
    expect(wire.opens).toHaveLength(1)
    expect(presence).toEqual(['online'])
    expect(end.status()).toEqual({ state: 'online' })
    expect(wire.posts.filter((entry) => entry.kind === 'events').length).toBeGreaterThanOrEqual(14)
  })

  it('breaks the connection on the machine after two missed pulses of the hub', async () => {
    const { wire, end } = await started()
    await tick(HEARTBEAT_MS)
    wire.mute = true
    await tick(HEARTBEAT_MS * 2 - 1)
    expect(wire.opens).toHaveLength(1)
    await tick(1)
    expect(end.status().state).not.toBe('online')
    wire.mute = false
    await tick(1_000)
    expect(wire.opens).toHaveLength(2)
    // The stream had worked before: this is a break, not a proxy that keeps the stream.
    expect(end.status()).toEqual({ state: 'online' })
  })

  it('breaks the connection on the hub after two missed pulses of the machine', async () => {
    const { wire, hub, id, presence, log } = await started()
    wire.hang = true
    await tick(HEARTBEAT_MS * 2 - 1)
    expect(hub.connected(id)).toBe(true)
    await tick(1)
    expect(presence).toEqual(['online', 'offline'])
    expect(log.some((line) => line.includes('missed 2 pulses'))).toBe(true)
  })

  it('tells a proxy that keeps the stream from a break', async () => {
    const made = await bench()
    stopHub = () => made.hub.stop()
    made.wire.hold = true
    const changes: string[] = []
    const machine = made.machine({ changed: () => void changes.push(machine.status().notice ?? '-') })
    running.push(machine)
    await machine.start()
    await tick(HEARTBEAT_MS * 2)
    expect(machine.status()).toEqual({ state: 'offline', notice: 'link.buffered' })
    expect(made.log.filter((line) => line.includes('a proxy'))).toHaveLength(1)
    // What the proxy lets go of afterwards belongs to a connection already given up.
    made.wire.release()
    made.wire.hold = true
    await tick(1_000 + HEARTBEAT_MS * 2)
    expect(made.wire.opens).toHaveLength(2)
    expect(machine.status().notice).toBe('link.buffered')
    expect(made.ran).toEqual([])
    made.wire.hold = false
    await tick(2_000)
    expect(made.wire.opens).toHaveLength(3)
    // The handshake alone may be the proxy's first flush: only a pulse in time clears the notice.
    expect(machine.status()).toEqual({ state: 'online', notice: 'link.buffered' })
    await tick(HEARTBEAT_MS)
    expect(machine.status()).toEqual({ state: 'online' })
    expect(changes).toContain('link.buffered')
  })

  it('runs a command only for an agreed project and folder', async () => {
    const { hub, id, ran, taken, machineStore } = await started()
    await machineStore.agree(PROJECT, '/repos/example')
    await hub.send(id, { type: 'example.other-project', project: '22222222-2222-4222-8222-222222222222' })
    await hub.send(id, { type: 'example.other-folder', project: PROJECT, folder: '/repos/another' })
    await hub.send(id, { type: 'example.no-project', folder: '/repos/example' })
    await hub.send(id, { type: 'example.sibling', project: PROJECT, folder: '/repos/example-two' })
    await hub.send(id, { type: 'example.inside', project: PROJECT, folder: '/repos/example/.claude/worktrees/abc-1' })
    await hub.send(id, { type: 'example.project', project: PROJECT })
    await hub.send(id, { type: 'example.machine' })
    await tick()
    expect(ran.map((command) => command.type)).toEqual(['example.inside', 'example.project', 'example.machine'])
    expect(taken.map((event) => [event.type, event.payload])).toEqual([
      [REFUSED_EVENT, { seq: 1, type: 'example.other-project', reason: 'project' }],
      [REFUSED_EVENT, { seq: 2, type: 'example.other-folder', reason: 'folder' }],
      [REFUSED_EVENT, { seq: 3, type: 'example.no-project', reason: 'folder' }],
      [REFUSED_EVENT, { seq: 4, type: 'example.sibling', reason: 'folder' }],
    ])
    expect(await machineStore.unfinishedCommands()).toEqual([])
  })

  it('reports a command that failed and goes on with the next one', async () => {
    const ran: number[] = []
    const { hub, id, taken } = await started({
      command: (command) => {
        if (command.seq === 1) throw new Error('no such session')
        ran.push(command.seq)
      },
    })
    await hub.send(id, { type: 'example.stop' })
    await hub.send(id, { type: 'example.start' })
    await tick()
    expect(ran).toEqual([2])
    expect(taken.map((event) => [event.type, event.payload])).toEqual([[FAILED_EVENT, { seq: 1, type: 'example.stop', error: 'no such session' }]])
  })

  it('reports a command the machine stopped in the middle of instead of running it again', async () => {
    const made = await bench()
    stopHub = () => made.hub.stop()
    await made.hub.send(made.token.machine, { type: 'example.start' })
    await made.machineStore.commandReceived(1)
    const machine = made.machine()
    running.push(machine)
    await machine.start()
    await tick()
    expect(made.ran).toEqual([])
    expect(made.taken.map((event) => [event.type, event.payload])).toEqual([[INTERRUPTED_EVENT, { seq: 1 }]])
    expect(await made.machineStore.unfinishedCommands()).toEqual([])
  })

  it('turns a revoked machine away and says so', async () => {
    const { hub, id, end, wire, presence } = await started()
    await hub.revoke(id)
    await tick()
    expect(presence).toEqual(['online', 'offline'])
    await tick(1_000)
    expect(end.status()).toEqual({ state: 'offline', notice: 'link.token' })
    const count = wire.opens.length
    await tick(29_999)
    expect(wire.opens).toHaveLength(count)
    await tick(1)
    expect(wire.opens).toHaveLength(count + 1)
    await expect(hub.events(wire.authorization, { connection: 'any', events: [], lastCommand: 0 })).resolves.toEqual({ refused: 'token' })
  })

  it('turns away a wrong secret and a missing header', async () => {
    const made = await bench()
    stopHub = () => made.hub.stop()
    const sink = { send: () => {}, close: () => {} }
    const hello = { api: API_VERSION, host: 'example-host', lastCommand: 0 }
    await expect(made.hub.open(`Bearer ${made.token.machine}.wrong`, hello, sink)).resolves.toEqual({ refused: 'token' })
    await expect(made.hub.open(undefined, hello, sink)).resolves.toEqual({ refused: 'token' })
    await expect(made.hub.open('Bearer unknown.secret', hello, sink)).resolves.toEqual({ refused: 'token' })
  })

  it('refuses another API version in the handshake', async () => {
    const { end, wire, presence, log } = await started({ api: API_VERSION + 1 })
    expect(end.status()).toEqual({ state: 'offline', notice: 'link.version' })
    expect(presence).toEqual([])
    expect(wire.posts).toEqual([])
    expect(log.some((line) => line.includes(`speaks API ${API_VERSION}`))).toBe(true)
  })

  it('gives the stream to the newest connection of a machine and refuses the posts of the older one', async () => {
    const made = await bench()
    stopHub = () => made.hub.stop()
    const authorization = made.wire.authorization
    const hello = { api: API_VERSION, host: 'example-host', lastCommand: 0 }
    const closed: string[] = []
    const first = await made.hub.open(authorization, hello, { send: () => {}, close: () => void closed.push('first') })
    const second = await made.hub.open(authorization, hello, { send: () => {}, close: () => void closed.push('second') })
    if ('refused' in first || 'refused' in second) throw new Error('refused')
    expect(closed).toEqual(['first'])
    await expect(made.hub.events(authorization, { connection: first.connection, events: [], lastCommand: 0 })).resolves.toEqual({ refused: 'connection' })
    await expect(made.hub.events(authorization, { connection: second.connection, events: [], lastCommand: 0 })).resolves.toEqual({ lastEvent: 0 })
    // The older stream's end must not take the newer one down.
    first.closed()
    expect(made.hub.connected(made.token.machine)).toBe(true)
  })

  it('carries the connection token as one line', () => {
    const token = { hub: 'https://hub.example.com:4750', fingerprint: 'cd'.repeat(32), machine: 'machine-1', secret: 'secret-1' }
    const line = encodeToken(token)
    expect(line).toMatch(/^ekm1\.[A-Za-z0-9_-]+$/)
    expect(parseToken(` ${line}\n`)).toEqual(token)
    expect(parseToken('ekm1.not-a-token')).toBeUndefined()
    expect(parseToken(encodeToken({ ...token, hub: 'http://hub.example.com' }))).toBeUndefined()
    expect(parseToken(encodeToken({ ...token, fingerprint: 'short' }))).toBeUndefined()
  })
})
