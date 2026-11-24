import { describe, expect, it } from 'vitest'
import type { HandoffSession } from '../chain/relay.js'
import { fail, noticeOf } from '../notice/notice.js'
import { machinePool, type PoolDeps } from './pool.js'
import type { MachinePort } from './port.js'

type Call = [machine: string, member: string]

/** A port that answers every member with its machine's name and writes down who was asked. */
function fakePort(machine: string, calls: Call[], saved?: string[]): MachinePort {
  const moves = {
    run: () => {
      calls.push([machine, 'moves.run'])
      return Promise.resolve({ kind: 'done' })
    },
    onSaved: () => void saved?.push(machine),
  }
  return new Proxy({} as MachinePort, {
    get: (_target, member: string) => {
      if (member === 'moves') return moves
      if (member === 'then') return undefined
      return () => {
        calls.push([machine, member])
        return machine
      }
    },
  })
}

function poolOf(overrides: Partial<PoolDeps> = {}) {
  const calls: Call[] = []
  const saved: string[] = []
  const ports = new Map(['own', 'pc', 'server'].map((machine) => [machine, fakePort(machine, calls, saved)]))
  const tasks = new Map([['p\nA-1', 'server'], ['p\nA-3', 'gone']])
  const pool = machinePool({
    own: () => 'own',
    port: (machine) => ports.get(machine),
    machineOf: (project, task) => tasks.get(`${project}\n${task}`),
    projectOf: (task) => (task.startsWith('A-') ? 'p' : undefined),
    sessionMachine: (id) => (id === 's-pc' ? 'pc' : undefined),
    folderMachine: (folder) => (folder === '/srv/p/a-1' ? 'server' : undefined),
    ...overrides,
  })
  return { pool, calls, saved }
}

const session = (sessionId: string): HandoffSession => ({ sessionId, workdir: '/w' }) as HandoffSession

describe('machinePool', () => {
  it('sends a task\'s calls to the machine the task went to', async () => {
    const { pool, calls } = poolOf()
    expect(await pool.launch('p', 'A-1')).toBe('server')
    expect(pool.busy('A-1')).toBe('server')
    expect(pool.liveSession('A-1')).toBe('server')
    expect((await pool.finish('p', 'A-1')).machine).toBe('server')
    expect(pool.account('p', 'A-1')).toBe('server')
    expect(calls.every(([machine]) => machine === 'server')).toBe(true)
  })

  it('sends a task with no machine, and one whose machine is gone, to the own one', async () => {
    const { pool } = poolOf()
    expect(await pool.launch('p', 'A-2')).toBe('own')
    expect(pool.liveSession('A-3')).toBe('own')
    expect(pool.account('p')).toBe('own')
  })

  it('never moves a launch, a resume, a relay or a move of a task bound to a machine with no port to the own one (BTN-1625)', async () => {
    const { pool, calls } = poolOf()
    const refused = async (call: () => unknown) => {
      try {
        await call()
      } catch (error) {
        return noticeOf(error)
      }
      return undefined
    }
    expect(await refused(() => pool.launch('p', 'A-3'))).toMatchObject({ code: 'machine.away', params: { command: 'launch', task: 'A-3' } })
    expect(await refused(() => pool.launchFix('p', 'A-3', 'red'))).toMatchObject({ code: 'machine.away' })
    expect(await refused(() => pool.resume('A-3', session('s-3')))).toMatchObject({ code: 'machine.away' })
    expect(await refused(() => pool.relay('A-3', session('s-3'), 'go on', 'limit'))).toMatchObject({ code: 'machine.away' })
    expect(await refused(() => pool.reply('A-3', session('s-3'), 'yes'))).toMatchObject({ code: 'machine.away' })
    expect(await refused(() => pool.moves!.run('follow', { project: 'p', task: 'A-3', args: [] } as never))).toMatchObject({ code: 'machine.away' })
    expect(calls).toEqual([])
    // Reads of such a task still fall back to the own one.
    expect(pool.liveSession('A-3')).toBe('own')
  })

  it("reads a task's packages on the machine it went to, a project's alone on the own one", () => {
    const { pool } = poolOf()
    expect(pool.packagesBlocked('p', 'A-1')).toBe('server')
    expect(pool.packagesPause('p', 'A-1')).toBe('server')
    expect(pool.packagesBlocked('p')).toBe('own')
    expect(pool.packagesPause('p', 'A-2')).toBe('own')
  })

  it("reads a task's limits on the machine it went to: the wait for its account's first poll there (BTN-1521)", () => {
    const { pool } = poolOf()
    expect(pool.limitsUnread('p', 'A-1')).toBe('server')
    expect(pool.limitReset('p', 'A-1')).toBe('server')
    expect(pool.limitsUnread('p', 'A-2')).toBe('own')
    expect(pool.limitsUnread('p')).toBe('own')
  })

  it("names the machine whose packages hold a task where it is not the own one (BTN-1524)", () => {
    const held = (machine: string) => ({ packagesHeld: () => ({ packages: [{ name: machine, problems: [{ kind: 'probing' }] }] }) }) as unknown as MachinePort
    const { pool } = poolOf({ port: (machine) => (machine === 'gone' ? undefined : held(machine)) })
    expect(pool.packagesHeld!('p', 'A-1')).toEqual({ machine: 'server', packages: [{ name: 'server', problems: [{ kind: 'probing' }] }] })
    expect(pool.packagesHeld!('p', 'A-2')).toEqual({ packages: [{ name: 'own', problems: [{ kind: 'probing' }] }] })
    expect(pool.packagesHeld!('p', 'A-3')).toEqual({ packages: [{ name: 'own', problems: [{ kind: 'probing' }] }] })
    expect(pool.packagesHeld!('p')).toEqual({ packages: [{ name: 'own', problems: [{ kind: 'probing' }] }] })
  })

  it('keeps the project\'s main, fix sessions and account reads on the own machine', async () => {
    const { pool } = poolOf()
    expect(await pool.head('p')).toBe('own')
    expect(await pool.sync('p')).toBe('own')
    expect(await pool.launchFix('p', 'fix', 'red')).toBe('own')
    expect(pool.sessionsRead()).toBe('own')
    expect(pool.trackerMissing('p')).toBe('own')
  })

  it("passes the bringing up of main to the own machine's commands after a green main (BTN-1597)", async () => {
    const asked: unknown[][] = []
    const own = { runAfterGreen: async (...args: unknown[]) => (asked.push(args), { state: 'done' }) } as unknown as MachinePort
    const { pool } = poolOf({ port: (machine) => (machine === 'own' ? own : undefined) })
    await pool.runAfterGreen('p', 'c2', true)
    expect(asked).toEqual([['p', 'c2', true]])
  })

  it("reads whether a task's sessions are read on its machine, and a machine with no snapshot since the hub started as unread (BTN-1610)", () => {
    const { pool, calls } = poolOf()
    expect(pool.sessionsRead('A-1')).toBe('server')
    expect(pool.sessionsRead('A-2')).toBe('own')
    calls.length = 0
    expect(pool.sessionsRead('A-3')).toBe(false)
    expect(calls).toEqual([])
  })

  it('names the machine a cleanup ran on, the own one for a task whose machine is gone (BTN-995)', async () => {
    const { pool } = poolOf()
    expect((await pool.finish('p', 'A-3')).machine).toBe('own')
    expect((await pool.finish('p', 'A-2')).machine).toBe('own')
  })

  it('gives a cleanup cut off by the machine leaving the link as a sync to try again there (BTN-995)', async () => {
    const lost = fail('machine.lockLost', { command: 'port.finish' })
    const away = { finish: () => Promise.reject(lost) } as unknown as MachinePort
    const { pool } = poolOf({ port: (machine) => (machine === 'server' ? away : fakePort(machine, [])) })
    expect(await pool.finish('p', 'A-1')).toEqual({ warnings: [], syncError: noticeOf(lost), machine: 'server' })
  })

  it('syncs and reads main on the machine named, and runs a fix bound to a machine there (BTN-995)', async () => {
    const { pool } = poolOf({ machineOf: (_project, task) => (task === 'P-FIX' ? 'pc' : undefined) })
    expect(await pool.sync('p', 'server')).toBe('server')
    expect(await pool.head('p', 'server')).toBe('server')
    expect(await pool.tree('p', 'abc', 'server')).toBe('server')
    expect(await pool.launchFix('p', 'P-FIX', 'red')).toBe('pc')
  })

  it('finds a session\'s machine for stop and locate, a folder\'s for changes', async () => {
    const { pool } = poolOf()
    expect(await pool.stop(session('s-pc'))).toBe('pc')
    expect(await pool.locate(session('s-x'))).toBe('own')
    expect(await pool.changes('p', '/srv/p/a-1')).toBe('server')
  })

  it('runs a move on the task\'s machine and hands the saved state\'s taker to each machine it reaches', async () => {
    const { pool, calls, saved } = poolOf()
    pool.moves!.onSaved(() => {})
    expect(saved).toEqual(['own'])
    await pool.moves!.run('follow', { project: 'p', task: 'A-1', args: [] } as never)
    expect(calls.at(-1)).toEqual(['server', 'moves.run'])
    expect(saved).toEqual(['own', 'server'])
    await pool.moves!.run('follow', { project: 'p', task: 'A-1', args: [] } as never)
    expect(saved).toEqual(['own', 'server'])
  })
})
