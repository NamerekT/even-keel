import { spawn, spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { isAlive, killTree, parseProcessTable, treeTargets } from './process.js'

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

describe.runIf(setsid)('killTree on Linux', () => {
  it('kills a command the turn ran in its own session', async () => {
    const turn = spawn('sh', ['-c', 'setsid sleep 30 & echo $!; wait'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const command = Number(await new Promise<string>((resolve) => turn.stdout.once('data', (data) => resolve(String(data)))))
    expect(isAlive(command)).toBe(true)

    await killTree(turn.pid!)

    await expect.poll(() => isAlive(command), { timeout: 5_000 }).toBe(false)
    await expect.poll(() => isAlive(turn.pid!), { timeout: 5_000 }).toBe(false)
  })
})
