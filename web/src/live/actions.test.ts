import { describe, expect, it } from 'vitest'
import { liveActions } from './actions.js'
import { Activity } from './activity.js'
import type { LiveSource } from './connection.js'

function waiting() {
  let finish!: () => void
  const answer = new Promise<void>((resolve) => (finish = resolve))
  const source = { command: () => answer } as unknown as LiveSource
  return { source, finish, answer }
}

describe('liveActions', () => {
  it('moves the top bar while a command is in flight', async () => {
    const bar = new Activity()
    const { source, finish } = waiting()
    const sent = liveActions(source, bar).command('chain/start', {})
    expect(bar.running()).toBe(1)
    finish()
    await sent
    expect(bar.running()).toBe(0)
  })

  it('keeps the top bar still while a chat message is delivered', async () => {
    const bar = new Activity()
    const { source, finish } = waiting()
    const sent = liveActions(source, bar).deliver('session/answer', { text: 'hello' })
    expect(bar.running()).toBe(0)
    finish()
    await sent
    expect(bar.running()).toBe(0)
  })
})
