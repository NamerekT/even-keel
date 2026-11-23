import { describe, expect, it } from 'vitest'
import { assembleChainControl, assembleStartChain } from './hub-bootstrap.js'

/** A hub whose own machine's facts reach the mirror only when it catches up, as within the settle window (BTN-1550). */
function hub() {
  const order: string[] = []
  const dispatcher = {
    start: async (project: string) => void order.push(`start ${project}`),
    resume: (project: string) => void order.push(`resume ${project}`),
    stop: (project: string) => void order.push(`stop ${project}`),
  }
  const ctx = {
    branches: { refresh: async () => void order.push('branches') },
    dispatcher,
    machineLink: { port: { catchUp: async () => void order.push('catchUp') } },
    SWITCHES: {},
  }
  const startChain = assembleStartChain(ctx as never)
  const control = assembleChainControl({ ...ctx, startChain } as never)
  return { order, control }
}

describe('the chain control of the hub', () => {
  it('catches up with the own machine before Start admits the chain', async () => {
    const { order, control } = hub()
    await control.start('ABC')
    expect(order).toEqual(['branches', 'catchUp', 'start ABC'])
  })

  it('catches up with the own machine before Resume admits the chain', async () => {
    const { order, control } = hub()
    await control.resume('ABC')
    expect(order).toEqual(['catchUp', 'resume ABC'])
  })

  it('leaves the other commands to the dispatcher as they are', () => {
    const { order, control } = hub()
    control.stop('ABC')
    expect(order).toEqual(['stop ABC'])
  })
})
