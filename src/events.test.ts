import { afterEach, describe, expect, it, vi } from 'vitest'
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

  describe('broadcastSoon', () => {
    afterEach(() => { vi.useRealTimers() })

    it('builds the data at once when nothing was built within the window, then folds a burst into one trailing build of the latest', () => {
      vi.useFakeTimers()
      const hub = new EventHub()
      const frames: string[] = []
      hub.subscribe((frame) => frames.push(frame))
      let n = 0
      const produce = vi.fn(() => ({ n: ++n }))

      hub.broadcastSoon('state', produce)
      expect(frames).toEqual([formatEvent('state', { n: 1 })])
      hub.broadcastSoon('state', produce)
      hub.broadcastSoon('state', produce)
      hub.broadcastSoon('state', produce)
      expect(produce).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(199)
      expect(produce).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1)
      expect(produce).toHaveBeenCalledTimes(2)
      expect(frames).toEqual([formatEvent('state', { n: 1 }), formatEvent('state', { n: 2 })])

      vi.advanceTimersByTime(1000)
      expect(produce).toHaveBeenCalledTimes(2)
    })

    it('takes the last producer asked for in a burst', () => {
      vi.useFakeTimers()
      const hub = new EventHub()
      const frames: string[] = []
      hub.subscribe((frame) => frames.push(frame))

      hub.broadcastSoon('state', () => 'a')
      hub.broadcastSoon('state', () => 'b')
      hub.broadcastSoon('state', () => 'c')
      vi.advanceTimersByTime(200)

      expect(frames).toEqual([formatEvent('state', 'a'), formatEvent('state', 'c')])
    })

    it('builds at once again after a quiet window', () => {
      vi.useFakeTimers()
      const hub = new EventHub()
      const frames: string[] = []
      hub.subscribe((frame) => frames.push(frame))

      hub.broadcastSoon('state', () => 1)
      vi.advanceTimersByTime(250)
      hub.broadcastSoon('state', () => 2)

      expect(frames).toEqual([formatEvent('state', 1), formatEvent('state', 2)])
    })

    it('builds nothing while no page listens, and a page that comes later is not held back by the old data', () => {
      vi.useFakeTimers()
      const hub = new EventHub()
      const produce = vi.fn(() => ({ a: 1 }))
      hub.broadcast('state', { a: 1 })
      hub.broadcastSoon('state', produce)
      vi.advanceTimersByTime(1000)
      expect(produce).not.toHaveBeenCalled()

      const frames: string[] = []
      hub.subscribe((frame) => frames.push(frame))
      hub.broadcastSoon('state', produce)
      expect(frames).toEqual([formatEvent('state', { a: 1 })])
    })
  })

  describe('an event sent in parts', () => {
    const session = (sessionId: string, lamp: string) => ({ sessionId, lamp })
    const parted = () => {
      const hub = new EventHub({ state: { sessions: 'sessionId' } })
      const frames: string[] = []
      hub.join('state', { a: 1, b: 1, sessions: [session('s-1', 'working'), session('s-2', 'finished')] }, (frame) => frames.push(frame))
      return { hub, frames }
    }
    const patchOf = (frame: string | undefined) => {
      expect(frame).toMatch(/^event: statePatch\ndata: .*\n\n$/)
      return JSON.parse(frame!.slice(frame!.indexOf('data: ') + 6)) as unknown
    }

    it('sends a joining page the data whole, then only the parts that changed', () => {
      const { hub, frames } = parted()
      expect(frames).toEqual([formatEvent('state', { a: 1, b: 1, sessions: [session('s-1', 'working'), session('s-2', 'finished')] })])

      hub.broadcast('state', { a: 1, b: 2, sessions: [session('s-1', 'working'), session('s-2', 'finished')] })
      expect(patchOf(frames[1])).toEqual({ parts: { b: 2 } })
    })

    it('sends a keyed part by its changed entries, with the order only when it changed', () => {
      const { hub, frames } = parted()
      hub.broadcast('state', { a: 1, b: 1, sessions: [session('s-1', 'finished'), session('s-2', 'finished')] })
      hub.broadcast('state', { a: 1, b: 1, sessions: [session('s-3', 'working'), session('s-1', 'finished')] })

      expect(patchOf(frames[1])).toEqual({ keyed: { sessions: { by: 'sessionId', changed: [session('s-1', 'finished')] } } })
      expect(patchOf(frames[2])).toEqual({ keyed: { sessions: { by: 'sessionId', order: ['s-3', 's-1'], changed: [session('s-3', 'working')] } } })
    })

    it('names the parts gone, and sends nothing when no part changed', () => {
      const { hub, frames } = parted()
      hub.broadcast('state', { a: 1, b: 1, sessions: [session('s-1', 'working'), session('s-2', 'finished')] })
      hub.broadcast('state', { a: 1, b: undefined, sessions: [session('s-1', 'working'), session('s-2', 'finished')] })

      expect(frames).toHaveLength(2)
      expect(patchOf(frames[1])).toEqual({ gone: ['b'] })
    })

    it('sends a keyed part whole when its entries do not name themselves apart', () => {
      const { hub, frames } = parted()
      const twins = [session('s-1', 'working'), session('s-1', 'finished')]
      hub.broadcast('state', { a: 1, b: 1, sessions: twins })
      hub.broadcast('state', { a: 1, b: 1, sessions: [session('s-1', 'working')] })

      expect(patchOf(frames[1])).toEqual({ parts: { sessions: twins } })
      expect(patchOf(frames[2])).toEqual({ keyed: { sessions: { by: 'sessionId', order: ['s-1'], changed: [session('s-1', 'working')] } } })
    })

    it('moves the pages already there to the data a new page joins with, so all share one base', () => {
      const { hub, frames } = parted()
      const late: string[] = []
      hub.join('state', { a: 2, b: 1, sessions: [session('s-1', 'working'), session('s-2', 'finished')] }, (frame) => late.push(frame))
      hub.broadcast('state', { a: 1, b: 1, sessions: [session('s-1', 'working'), session('s-2', 'finished')] })

      expect(patchOf(frames[1])).toEqual({ parts: { a: 2 } })
      expect(patchOf(frames[2])).toEqual({ parts: { a: 1 } })
      expect(late).toEqual([formatEvent('state', { a: 2, b: 1, sessions: [session('s-1', 'working'), session('s-2', 'finished')] }), frames[2]])
    })

    it('sends the data whole again once the pages that had a base are gone', () => {
      vi.useFakeTimers()
      const hub = new EventHub({ state: {} })
      const frames: string[] = []
      const leave = hub.join('state', { a: 1 }, (frame) => frames.push(frame))
      leave()
      hub.broadcastSoon('state', () => ({ a: 2 }))
      hub.subscribe((frame) => frames.push(frame))
      hub.broadcast('state', { a: 3 })

      expect(frames).toEqual([formatEvent('state', { a: 1 }), formatEvent('state', { a: 3 })])
      vi.useRealTimers()
    })
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
