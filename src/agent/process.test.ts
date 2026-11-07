import { spawn, spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { isAlive, killTree, parseProcessTable, stopTree, treeTargets } from './process.js'

describe('treeTargets', () => {
  const table = parseProcessTable([
    '  10     1    10',
    '  11    10    10',
    '  12    11    12',
    '  13    12    12',
    '  14     1    14',
    '  15    14    14',
    '  20     1    20',
    '  21    10    20',
  ].join('\n'))

  it('takes the groups of the turn and of descendants in their own group, not of strangers', () => {
    expect(treeTargets(table, 10, 99)).toEqual({ groups: [10, 20, 12], pids: [] })
  })

  it('never signals the service own group: such a descendant is killed alone', () => {
    expect(treeTargets(table, 10, 21)).toEqual({ groups: [10, 12], pids: [21] })
  })

  it('falls back to the turn group when the turn is not in the table', () => {
    expect(treeTargets(table, 30, 99)).toEqual({ groups: [30], pids: [] })
  })
})

const setsid = process.platform === 'linux' && spawnSync('setsid', ['--version']).status === 0

/**
 * In a CI container PID 1 may never reap orphans: the killed command stays a zombie that `kill(pid, 0)` still finds.
 * The state comes from `ps`, not `/proc`: macOS has no `/proc`.
 */
function running(pid: number): boolean {
  if (!isAlive(pid)) return false
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()
  return state !== '' && !state.startsWith('Z')
}

describe.runIf(setsid)('killTree on Linux', () => {
  it('kills a command the turn ran in its own session', { timeout: 15_000 }, async () => {
    const turn = spawn('sh', ['-c', 'setsid sleep 30 & echo $!; wait'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const command = Number(await new Promise<string>((resolve) => turn.stdout.once('data', (data) => resolve(String(data)))))
    expect(running(command)).toBe(true)

    await killTree(turn.pid!)

    await expect.poll(() => running(command), { timeout: 5_000 }).toBe(false)
    await expect.poll(() => running(turn.pid!), { timeout: 5_000 }).toBe(false)
  })
})

/** A turn with its own `SIGTERM` handler, frozen by `SIGSTOP`: the handler never runs (EKR-64). */
async function frozenTurn(): Promise<number> {
  const script = "process.on('SIGTERM', () => process.exit(0)); console.log('ready'); setInterval(() => {}, 1000)"
  const turn = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
  await new Promise((resolve) => turn.stdout.once('data', resolve))
  process.kill(turn.pid!, 'SIGSTOP')
  return turn.pid!
}

const waits = { termMs: 1_000, killMs: 3_000, pollMs: 100 }

describe.runIf(process.platform !== 'win32')('stopTree on Unix', () => {
  it('kills a turn that outlived SIGTERM while the pid is still the turn own', { timeout: 15_000 }, async () => {
    const pid = await frozenTurn()

    expect(await stopTree(pid, async () => true, waits)).toBe(true)
    expect(running(pid)).toBe(false)
  })

  it('gives up without SIGKILL once the pid is not the turn own', { timeout: 15_000 }, async () => {
    const pid = await frozenTurn()
    try {
      expect(await stopTree(pid, async () => false, waits)).toBe(false)
      expect(running(pid)).toBe(true)
    } finally {
      process.kill(pid, 'SIGKILL')
    }
  })
})
