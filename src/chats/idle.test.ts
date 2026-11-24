import { describe, expect, it } from 'vitest'
import { ABC } from '../storage/database.fixture.js'
import type { SessionView } from '../state.js'
import { FAR, setup, view } from './chats.fixture.js'
import { roomFor } from './model.js'

const at = (minute: number) => new Date(Date.parse('2026-11-18T10:00:00.000Z') + minute * 60_000).toISOString()
const warm = (minutes: number): SessionView['cache'] => ({ ttl: '1h', until: at(minutes) })
const stops = (calls: Array<[string, ...unknown[]]>) => calls.filter(([name]) => name === 'stop').map(([, chat]) => chat)

describe('roomFor (BTN-1653)', () => {
  it('names the longest idle chats over the ceiling, never one that works, waits or starts', () => {
    const live = [
      { id: 'a', state: 'answered' as const, lastAt: at(5) },
      { id: 'b', state: 'working' as const, lastAt: at(1) },
      { id: 'c', state: 'cold' as const, lastAt: at(3) },
    ]
    expect(roomFor(live, 4)).toEqual([])
    expect(roomFor(live, 3)).toEqual(['c'])
    expect(roomFor(live, 2)).toEqual(['c', 'a'])
    expect(roomFor(live, 1)).toEqual(['c', 'a'])
    expect(roomFor([{ id: 'w', state: 'waiting', lastAt: at(0) }, { id: 's', state: 'starting', lastAt: at(0) }], 1)).toEqual([])
  })
})

describe('ProjectChats: idle sessions (BTN-1653)', { timeout: 120_000 }, () => {
  it('stops the session of a chat whose cache went cold, keeps the chat active and resumes it with the next message', async () => {
    const { chats, calls, sessions, close, tick } = await setup()
    try {
      const { id } = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.send(id, { text: 'Why is the build slow?', files: [] })
      sessions.push(view(id, `session-${id}`, { lastActivityAt: at(1), cache: warm(56) }))
      tick(30 * 60_000)
      await chats.sweep()
      expect(stops(calls)).toEqual([])
      tick(30 * 60_000)
      await chats.sweep()
      expect(stops(calls)).toEqual([id])
      expect(chats.list(ABC)).toEqual([expect.objectContaining({ id, state: 'cold' })])
      tick(60_000)
      await chats.sweep()
      expect(stops(calls)).toEqual([id])
      sessions[0] = { ...sessions[0]!, lamp: 'finished' }
      tick(5 * 60_000)
      await chats.sweep()
      expect(stops(calls)).toEqual([id])
      await chats.send(id, { text: 'And the tests?', files: [] })
      expect(calls.at(-1)).toEqual(['send', ABC, id, expect.objectContaining({ prompt: 'And the tests?\n' })])
    } finally {
      await close()
    }
  })

  it('leaves a cold chat that works or waits on a question', async () => {
    const { chats, calls, sessions, close, tick } = await setup()
    try {
      const working = await chats.create(ABC, { account: 'global', model: null, effort: null })
      const asking = await chats.create(ABC, { account: 'global', model: null, effort: null })
      for (const { id } of [working, asking]) await chats.send(id, { text: 'Hello', files: [] })
      sessions.push(view(working.id, `session-${working.id}`, { lamp: 'working', cache: warm(5) }))
      sessions.push(view(asking.id, `session-${asking.id}`, { asking: true, cache: warm(5) }))
      tick(60 * 60_000)
      await chats.sweep()
      expect(stops(calls)).toEqual([])
    } finally {
      await close()
    }
  })

  it("stops the machine's longest idle chat for a new one over the ceiling, never one that works", async () => {
    const { chats, calls, sessions, logged, close, tick } = await setup()
    try {
      const ids: string[] = []
      for (const minute of [0, 1, 2]) {
        const { id } = await chats.create(ABC, { account: 'global', model: null, effort: null })
        await chats.send(id, { text: `Question ${minute}`, files: [] })
        ids.push(id)
        tick(60_000)
      }
      const far = await chats.create(ABC, { account: 'global', model: null, effort: null }, FAR)
      await chats.send(far.id, { text: 'Elsewhere', files: [] })
      sessions.push(view(ids[0]!, `session-${ids[0]}`, { lamp: 'working', lastActivityAt: at(0), cache: warm(60) }))
      sessions.push(view(ids[1]!, `session-${ids[1]}`, { lastActivityAt: at(1), cache: warm(60) }))
      sessions.push(view(ids[2]!, `session-${ids[2]}`, { lastActivityAt: at(2), cache: warm(60) }))
      sessions.push(view(far.id, `session-${far.id}`, { lastActivityAt: at(0), cache: warm(60) }))
      expect(stops(calls)).toEqual([])
      const fourth = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.send(fourth.id, { text: 'One more', files: [] })
      expect(stops(calls)).toEqual([ids[1]])
      expect(calls.findIndex(([name]) => name === 'stop')).toBeLessThan(calls.findIndex(([name, , , chat]) => name === 'launch' && chat === fourth.id))
      expect(logged.some((line) => line.includes(ids[1]!) && line.includes('ceiling'))).toBe(true)
      expect(chats.list(ABC).map((card) => card.id).sort()).toEqual([...ids, far.id, fourth.id].sort())
    } finally {
      await close()
    }
  })

  it('makes room before a stopped session is resumed, but not for a message into a live one', async () => {
    const { chats, calls, sessions, switches, close, tick } = await setup()
    try {
      switches.ceiling = 1
      const first = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.send(first.id, { text: 'Hello', files: [] })
      tick(60_000)
      const second = await chats.create(ABC, { account: 'global', model: null, effort: null })
      sessions.push(view(first.id, `session-${first.id}`, { lastActivityAt: at(0), cache: warm(60) }))
      await chats.send(second.id, { text: 'Hello', files: [] })
      expect(stops(calls)).toEqual([first.id])
      sessions.push(view(second.id, `session-${second.id}`, { lastActivityAt: at(1), cache: warm(60) }))
      await chats.send(second.id, { text: 'Again', files: [] })
      expect(stops(calls)).toEqual([first.id])
      sessions[0] = { ...sessions[0]!, lamp: 'finished' }
      tick(5 * 60_000)
      await chats.send(first.id, { text: 'Back', files: [] })
      expect(stops(calls)).toEqual([first.id, second.id])
    } finally {
      await close()
    }
  })

  it('starts a chat over the ceiling when every live one works, and when a stop fails', async () => {
    const { chats, calls, sessions, switches, logged, close } = await setup()
    try {
      switches.ceiling = 1
      const busy = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.send(busy.id, { text: 'Hello', files: [] })
      sessions.push(view(busy.id, `session-${busy.id}`, { lamp: 'working' }))
      const next = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.send(next.id, { text: 'Hello', files: [] })
      expect(stops(calls)).toEqual([])
      sessions[0] = { ...sessions[0]!, lamp: 'waiting', cache: warm(60) }
      sessions.push(view(next.id, `session-${next.id}`, { lastActivityAt: at(1), cache: warm(60) }))
      switches.stopFails = true
      const third = await chats.create(ABC, { account: 'global', model: null, effort: null })
      await chats.send(third.id, { text: 'Hello', files: [] })
      expect(stops(calls)).toEqual([busy.id, next.id])
      expect(calls.at(-1)).toEqual(['launch', ABC, expect.any(String), third.id, expect.anything()])
      expect(logged.filter((line) => line.includes('was not stopped'))).toHaveLength(2)
    } finally {
      await close()
    }
  })
})
