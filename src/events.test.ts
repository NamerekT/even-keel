import { describe, expect, it } from 'vitest'
import { EventHub, formatEvent } from './events.js'

describe('formatEvent', () => {
  it('writes an SSE frame with the event name and JSON data', () => {
    expect(formatEvent('state', { a: 1 })).toBe('event: state\ndata: {"a":1}\n\n')
  })
})

describe('EventHub', () => {
  it('sends a broadcast to every subscriber until it unsubscribes', () => {
    const hub = new EventHub()
    const first: string[] = []
    const second: string[] = []
    const dropFirst = hub.subscribe((frame) => first.push(frame))
    hub.subscribe((frame) => second.push(frame))

    hub.broadcast('ping', 1)
    dropFirst()
    hub.broadcast('ping', 2)

    expect(first).toEqual([formatEvent('ping', 1)])
    expect(second).toEqual([formatEvent('ping', 1), formatEvent('ping', 2)])
    expect(hub.size).toBe(1)
  })

  it('does not repeat an event whose data has not changed since its last broadcast', () => {
    const hub = new EventHub()
    const frames: string[] = []
    hub.subscribe((frame) => frames.push(frame))

    hub.broadcast('state', { a: 1 })
    hub.broadcast('state', { a: 1 })
    hub.broadcast('ping', 1)
    hub.broadcast('state', { a: 2 })
    hub.broadcast('state', { a: 1 })

    expect(frames).toEqual([
      formatEvent('state', { a: 1 }),
      formatEvent('ping', 1),
      formatEvent('state', { a: 2 }),
      formatEvent('state', { a: 1 }),
    ])
  })

  it('sends a signal every time, even with the same data', () => {
    const hub = new EventHub()
    const frames: string[] = []
    hub.subscribe((frame) => frames.push(frame))

    hub.signal('transcript', { sessionId: 's-1' })
    hub.signal('transcript', { sessionId: 's-1' })

    expect(frames).toEqual([formatEvent('transcript', { sessionId: 's-1' }), formatEvent('transcript', { sessionId: 's-1' })])
  })
})
