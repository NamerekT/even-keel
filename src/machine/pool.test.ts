import { describe, expect, it } from 'vitest'
import type { HandoffSession } from '../chain/relay.js'
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
    expect(await pool.finish('p', 'A-1')).toBe('server')
    expect(pool.account('p', 'A-1')).toBe('server')
    expect(calls.every(([machine]) => machine === 'server')).toBe(true)
  })

  it('sends a task with no machine, and one whose machine is gone, to the own one', async () => {
    const { pool } = poolOf()
    expect(await pool.launch('p', 'A-2')).toBe('own')
    expect(pool.liveSession('A-3')).toBe('own')
    expect(pool.account('p')).toBe('own')
  })

  it('keeps the project\'s main, fix sessions and account reads on the own machine', async () => {
    const { pool } = poolOf()
    expect(await pool.head('p')).toBe('own')
    expect(await pool.sync('p')).toBe('own')
    expect(await pool.launchFix('p', 'fix', 'red')).toBe('own')
    expect(pool.sessionsRead()).toBe('own')
    expect(pool.trackerMissing('p')).toBe('own')
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
    await pool.moves!.run('follow', { project: 'p', args: ['A-1'] } as never)
    expect(calls.at(-1)).toEqual(['server', 'moves.run'])
    expect(saved).toEqual(['own', 'server'])
    await pool.moves!.run('follow', { project: 'p', args: ['A-1'] } as never)
    expect(saved).toEqual(['own', 'server'])
  })
})
