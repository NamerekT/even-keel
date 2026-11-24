import { existsSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuiltinStore } from '../builtin/store.js'
import { commitAndMerge, Gate } from './agent.fixture.js'
import { Elsewhere } from './elsewhere.fixture.js'
import { ACCOUNT, Harness, PROJECT_ID } from './service.fixture.js'
import { scaled } from '../../test/slow-runner.js'

const TASKS = 'tasks@even-keel'

interface PoolRow {
  id: string
  own: boolean
  enabled: boolean
}

describe('a machine elsewhere end to end', { timeout: scaled(180_000) }, () => {
  let run: Harness
  let elsewhere: Elsewhere

  beforeEach(() => {
    run = new Harness()
    elsewhere = new Elsewhere(run)
  })

  afterEach(async () => {
    await elsewhere.stop()
    await run.stop()
  })

  const statusOf = async (number: number) => (await new BuiltinStore(run.service.db).get({ project: PROJECT_ID, number }))?.status.name
  const installsOf = (file: string): string[] => {
    const read = JSON.parse(readFileSync(file, 'utf8')) as { packages: Record<string, { installs: { id: string }[] }> }
    return (read.packages[TASKS]?.installs ?? []).map((install) => install.id)
  }

  /** The hub with the tasks package and one task, the machine joined, connected and, unless `keepOwn`, the project's only machine. */
  async function connected(prepared?: () => void, keepOwn = false): Promise<string> {
    run.forge = true
    run.project.tracker = 'builtin'
    run.agent.script('ABC-1', commitAndMerge('ABC-1.txt'))
    await run.start(() => {
      elsewhere.prepare()
      prepared?.()
    })
    await run.post('packages/plugin', { plugin: 'tasks', marketplace: 'even-keel', project: PROJECT_ID })
    await run.until(() => run.service.packages.view().packages.some((each) => each.name === TASKS && each.installed) && run.service.packages.unready(PROJECT_ID).length === 0, 'the tasks package installed on the hub')
    const hubInstalls = installsOf(join(run.dir, 'data', 'state', 'packages.json'))
    expect(hubInstalls).toHaveLength(1)
    await run.post('builtin/create', { project: PROJECT_ID, title: 'Work elsewhere' })

    const machine = await elsewhere.join()
    // Only the built-in package was seeded there: the tracker's server is missing until the hub's catalog comes.
    expect(elsewhere.host.packages.view().packages.map((each) => each.name)).not.toContain(TASKS)
    await run.post('machines/connect', { project: PROJECT_ID, machine, clone: true })
    const pool = async () => (await run.answer<{ machines: PoolRow[] }>('machines/pool', { project: PROJECT_ID })).machines
    let rows: PoolRow[] = []
    await run.until(() => {
      void pool().then((each) => (rows = each))
      return rows.some((row) => row.id === machine && row.enabled)
    }, 'the machine connected', { step: 500 })
    const own = rows.find((row) => row.own)!
    if (!keepOwn) await run.post('machines/enable', { project: PROJECT_ID, machine: own.id, enabled: false })

    expect(existsSync(join(elsewhere.checkout, '.git'))).toBe(true)
    expect(installsOf(join(elsewhere.dir, 'state', 'packages.json'))).toEqual(hubInstalls)
    expect(existsSync(join(elsewhere.dir, 'state', 'packages', TASKS, hubInstalls[0]!))).toBe(true)
    expect(elsewhere.host.packages.trackerMissing(PROJECT_ID)).toBeUndefined()
    // The servers the hub runs answer the machine's gateway over the link once probed.
    await run.until(() => !elsewhere.host.packages.blocked(PROJECT_ID), `the packages of the machine ready: ${JSON.stringify(elsewhere.host.packages.check(PROJECT_ID).cells)}`)
    return machine
  }

  const done = async () => {
    let last: string | undefined
    await run.until(() => {
      void statusOf(1).then((status) => (last = status))
      return last === 'Done'
    }, 'ABC-1 done', { limitMs: 10 * 60_000 })
  }

  it("without a catalog of its own takes the tasks package under the hub's install and runs a task of the built-in tracker (BTN-1306)", async () => {
    await connected()
    await run.startChain(PROJECT_ID)
    await done()

    const launches = run.agent.calls.filter((call) => call.kind === 'launch')
    expect(launches.map((call) => call.task)).toEqual(['ABC-1'])
    expect(launches[0]!.cwd.startsWith(elsewhere.checkout + sep) || launches[0]!.cwd.startsWith(`${elsewhere.checkout}/`)).toBe(true)
    expect(run.gitIn(elsewhere.checkout, 'log', '--format=%s', 'main').split('\n')).toContain('[ABC-1] Work')
  })

  it('launches on the model the task was given right before the chain started, not on the brief the machine held (BTN-1514)', async () => {
    await connected()
    await run.post('task/run', { task: 'ABC-1', provider: 'claude', model: 'haiku' })
    await run.startChain(PROJECT_ID)
    await done()

    const launches = run.agent.calls.filter((call) => call.kind === 'launch')
    expect(launches.map(({ task, provider, model }) => ({ task, provider, model }))).toEqual([{ task: 'ABC-1', provider: 'claude', model: 'haiku' }])
  })

  it("gives a task pinned to the machine elsewhere to that machine while the hub's own machine is free (BTN-1623)", async () => {
    const machine = await connected(undefined, true)
    await run.post('task/run', { task: 'ABC-1', machines: [machine] })
    await run.startChain(PROJECT_ID)
    await done()

    const launches = run.agent.calls.filter((call) => call.kind === 'launch')
    expect(launches.map((call) => call.task)).toEqual(['ABC-1'])
    expect(launches[0]!.cwd.startsWith(elsewhere.checkout + sep) || launches[0]!.cwd.startsWith(`${elsewhere.checkout}/`)).toBe(true)
  })

  it("reads the transcript and the checkpoint of a session elsewhere on that machine, not in the hub's own folders (BTN-1574)", async () => {
    const gate = new Gate()
    run.agent.script('ABC-1', async (turn) => {
      turn.show({ text: 'Working', context: 120_000 })
      await turn.park(gate)
      return commitAndMerge('ABC-1.txt')(turn)
    })
    await connected()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.agent.sessionsOf('ABC-1').length > 0, 'the session launched', { limitMs: 10 * 60_000 })
    const sessionId = run.agent.sessionsOf('ABC-1')[0]!.sessionId
    await run.until(() => run.service.machineLink.network.holderOf(sessionId) === elsewhere.machine, 'the machine holds the session')

    const homes: string[] = []
    const record = run.agent.record.bind(run.agent)
    run.agent.record = async (home, id) => {
      if (id === sessionId) homes.push(home.dir)
      return record(home, id)
    }
    const { host, port } = run.service.listen
    const read = (path: string) => fetch(`http://${host}:${port}/api/sessions/${sessionId}${path}`)
    const found = await read('')
    expect(found.status).toBe(200)
    expect(await found.json()).toMatchObject({ sessionId })
    expect((await read('/transcript')).status).not.toBe(400)
    let context: unknown
    await run.until(() => {
      void read('/checkpoint').then((response) => response.json()).then((body: { context: unknown }) => (context = body.context))
      return context === 120_000
    }, `the context of the machine's monitor: ${String(context)}`, { step: 500 })
    expect(homes.length).toBeGreaterThan(0)
    expect(homes.every((dir) => dir.startsWith(elsewhere.dir))).toBe(true)

    gate.open()
    await done()
  })

  it("names the wait for the first limits poll of the machine's account in the chain, and launches once it answers (BTN-1521)", async () => {
    const gate = new Gate()
    // Every first poll is held, the hub's too, whose limits of the same account the machine would take: the account is
    // signed in on the machine, but its limits are not read yet.
    run.agent.windows = () => ({ fiveHour: null, sevenDay: null })
    await connected(() => (run.agent.usageGate = gate))
    expect(elsewhere.host.limits.unread(ACCOUNT)).toBe(true)
    await run.startChain(PROJECT_ID)

    const lane = () => run.service.dispatcher.state.active.find((chain) => chain.project === PROJECT_ID)
    await run.until(() => lane()?.limitsWait !== undefined, `the wait named: ${JSON.stringify(lane())}`, { limitMs: 10 * 60_000 })
    expect(lane()).toMatchObject({ current: null, paused: false, error: null, limitsWait: { account: ACCOUNT } })
    expect(run.agent.calls.filter((call) => call.kind === 'launch')).toEqual([])

    gate.open()
    await done()
    expect(lane()?.limitsWait).toBeUndefined()
  })

  it("asked to stop, waits out the turn of a session elsewhere through the hub's restart before the machine posts its sessions (BTN-1610)", async () => {
    const gate = new Gate()
    run.agent.script('ABC-1', async (turn) => {
      turn.show({ text: 'Working', context: 120_000 })
      await turn.park(gate)
      return { say: 'Stopped here' }
    })
    await connected()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.agent.sessionsOf('ABC-1').length > 0, 'the session launched', { limitMs: 10 * 60_000 })
    const sessionId = run.agent.sessionsOf('ABC-1')[0]!.sessionId
    await run.until(() => run.service.machineLink.port.midTurn('ABC-1'), 'the hub sees the session mid-turn')

    const lane = () => run.service.dispatcher.state.active.find((chain) => chain.project === PROJECT_ID)
    await run.post('chain/stopAfter', { project: PROJECT_ID, on: true })
    expect(lane()).toMatchObject({ current: { task: 'ABC-1', sessionId }, stopAfter: true })

    // The hub comes up two minutes later, before the machine is back on the link: nothing of its sessions is known.
    // The halt's `vi.clearAllTimers` rewinds the fake clock to the start; set back, the session is no fresh launch.
    const downAt = Date.now()
    await run.restart(() => {
      elsewhere.offLink()
      vi.setSystemTime(downAt + 2 * 60_000)
    })
    await run.pass(60_000)
    expect(run.service.machineLink.port.sessionsRead('ABC-1')).toBe(false)
    expect(lane()).toMatchObject({ current: { task: 'ABC-1', sessionId }, stopAfter: true })

    await elsewhere.backOnLink()
    await run.until(() => run.service.machineLink.port.sessionsRead('ABC-1'), 'the machine posted its sessions')
    await run.pass(30_000)
    expect(lane()).toMatchObject({ current: { task: 'ABC-1', sessionId }, stopAfter: true })
    expect(run.log.join('\n')).not.toContain('stopped after its session\'s turn')

    gate.open()
    await run.until(() => lane() === undefined, 'the lane stopped after the turn', { limitMs: 5 * 60_000 })
    expect(run.service.dispatcher.state.released[PROJECT_ID]).toEqual(['ABC-1'])
    expect(await statusOf(1)).not.toBe('Done')
  })
})
