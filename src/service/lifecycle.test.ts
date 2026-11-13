import { describe, expect, it } from 'vitest'
import { shutdown } from './lifecycle.js'

function contextOf(order: string[], packages: () => Promise<void> = async () => void order.push('packages')) {
  return {
    cliChecks: { stop: () => void order.push('cliChecks') },
    packages: { close: packages },
    tally: { stop: async () => void order.push('tally') },
    backups: { stop: async () => void order.push('backups') },
    writes: { settled: async () => void order.push('writes') },
    stateDb: { close: async () => void order.push('stateDb') },
  } as unknown as Parameters<typeof shutdown>[0]
}

describe('shutdown', () => {
  it('closes the MCP gateway with Tally and the state database: under systemd and launchd its servers outlive node', async () => {
    const order: string[] = []
    await shutdown(contextOf(order))
    expect(order).toEqual(expect.arrayContaining(['cliChecks', 'packages', 'tally', 'backups', 'writes', 'stateDb']))
    expect(order.indexOf('stateDb')).toBeGreaterThan(order.indexOf('writes'))
    // The backup reads the database: its copy is stopped before the database closes.
    expect(order.indexOf('stateDb')).toBeGreaterThan(order.indexOf('backups'))
  })

  it('still closes the rest when the gateway fails to close', async () => {
    const order: string[] = []
    await shutdown(contextOf(order, () => Promise.reject(new Error('boom'))))
    expect(order).toEqual(expect.arrayContaining(['tally', 'stateDb']))
  })
})
