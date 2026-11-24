import { describe, expect, it } from 'vitest'
import type { AfterGreenRun } from '../chain/model.js'
import { PoolAfterGreen } from './pool-after-green.js'

const HUB = 'hub'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)

/** The project's pool: the hub, a server with its own commands, a laptop with the project's, a desktop with none. */
function setup(online: Set<string> = new Set(['server', 'laptop', 'desktop'])) {
  const rows = new Map([
    ['server', { commands: ['./deploy.sh'], ran: null as string | null }],
    ['laptop', { commands: ['npm run build'], ran: null as string | null }],
    ['desktop', { commands: [] as string[], ran: null as string | null }],
    [HUB, { commands: ['npm run build'], ran: null as string | null }],
  ])
  const runs: string[] = []
  const lines: string[] = []
  const held = new Map<string, () => void>()
  let green: string | undefined
  const port = (machine: string) => ({
    runAfterGreen: async (project: string, commit: string, forward?: boolean): Promise<AfterGreenRun> => {
      runs.push(`${machine} ${project}@${commit.slice(0, 1)}${forward === true ? ' forward' : ''}`)
      if (machine === 'laptop') await new Promise<void>((resolve) => held.set(commit, resolve))
      return { state: 'done' }
    },
  })
  const pool = new PoolAfterGreen({
    own: () => HUB,
    pool: async (_project, machine) => [...rows].filter(([id]) => machine === undefined || id === machine).map(([id, row]) => ({ machine: id, ...row })),
    projectsOf: async () => ['ABC'],
    mark: async (_project, machine, commit) => void (rows.get(machine)!.ran = commit),
    ready: (machine) => online.has(machine),
    port,
    green: () => green,
    name: (machine) => (machine === 'server' ? 'Build server' : machine),
    log: (line) => void lines.push(line),
  })
  return { pool, runs, rows, held, online, lines, setGreen: (commit: string) => (green = commit) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the commands after a green main on the machines of the pool (BTN-994)', () => {
  it('runs them on each machine elsewhere with commands, bringing its main up to the commit, never on the hub', async () => {
    const { pool, runs, rows, held } = setup()
    pool.green('ABC', A)
    await settle()
    held.get(A)?.()
    await pool.idle()
    expect(runs.sort()).toEqual(['laptop ABC@a forward', 'server ABC@a forward'])
    expect(rows.get('server')?.ran).toBe(A)
    expect(rows.get(HUB)?.ran).toBeNull()
    // The same commit once more runs nowhere.
    pool.green('ABC', A)
    await pool.idle()
    expect(runs).toHaveLength(2)
  })

  it('runs one at a time per machine, the latest green commit next', async () => {
    const { pool, runs, held } = setup(new Set(['laptop']))
    pool.green('ABC', A)
    await settle()
    pool.green('ABC', B)
    pool.green('ABC', C)
    await settle()
    expect(runs).toEqual(['laptop ABC@a forward'])
    held.get(A)!()
    await settle()
    await settle()
    held.get(C)!()
    await pool.idle()
    expect(runs).toEqual(['laptop ABC@a forward', 'laptop ABC@c forward'])
  })

  it('catches a machine that was off the link up once, on the last green commit only', async () => {
    const { pool, runs, online, setGreen } = setup(new Set())
    pool.green('ABC', A)
    setGreen(A)
    pool.green('ABC', B)
    setGreen(B)
    await pool.idle()
    expect(runs).toEqual([])
    online.add('server')
    pool.back('server')
    await pool.idle()
    pool.back('server')
    await pool.idle()
    expect(runs).toEqual(['server ABC@b forward'])
  })

  it('names the machine in the log by the name the hub gave it (BTN-1597)', async () => {
    const { pool, lines } = setup(new Set(['server']))
    pool.green('ABC', A)
    await pool.idle()
    expect(lines).toEqual(['afterGreen: ABC: machine "Build server" runs the commands after aaaaaaa', 'afterGreen: ABC: machine "Build server" is done with the commands after aaaaaaa'])
  })
})
