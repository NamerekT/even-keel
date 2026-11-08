import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastClock, type ToastClockView } from './toastClock.js'

const MS = 12_000

describe('ToastClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const start = (hidden = false) => {
    const onTimeout = vi.fn()
    const views: ToastClockView[] = []
    const clock = new ToastClock(MS, onTimeout, hidden, (view) => views.push(view))
    return { clock, onTimeout, views }
  }

  it('times out after the whole time in sight', () => {
    const { onTimeout, clock } = start()
    expect(clock.view()).toEqual({ running: true, round: 0 })
    vi.advanceTimersByTime(MS - 1)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('stands while the pointer is over it and goes on from the same place', () => {
    const { clock, onTimeout } = start()
    vi.advanceTimersByTime(4_000)
    clock.hold('pointer', true)
    expect(clock.view()).toEqual({ running: false, round: 0 })
    vi.advanceTimersByTime(60_000)
    expect(onTimeout).not.toHaveBeenCalled()
    clock.hold('pointer', false)
    expect(clock.view()).toEqual({ running: true, round: 0 })
    vi.advanceTimersByTime(MS - 4_000 - 1)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('stands until both the pointer and the focus are gone', () => {
    const { clock, onTimeout } = start()
    clock.hold('pointer', true)
    clock.hold('focus', true)
    clock.hold('pointer', false)
    expect(clock.view().running).toBe(false)
    vi.advanceTimersByTime(MS * 2)
    expect(onTimeout).not.toHaveBeenCalled()
    clock.hold('focus', false)
    vi.advanceTimersByTime(MS)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('waits in a hidden tab and starts over, full, once the tab shows', () => {
    const { clock, onTimeout } = start(true)
    expect(clock.view()).toEqual({ running: false, round: 0 })
    vi.advanceTimersByTime(MS * 3)
    expect(onTimeout).not.toHaveBeenCalled()
    clock.hide(false)
    expect(clock.view()).toEqual({ running: true, round: 1 })
    vi.advanceTimersByTime(8_000)
    clock.hide(true)
    vi.advanceTimersByTime(MS)
    clock.hide(false)
    expect(clock.view()).toEqual({ running: true, round: 2 })
    vi.advanceTimersByTime(MS - 1)
    expect(onTimeout).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('starts over in sight but stays held when the focus is still inside', () => {
    const { clock, onTimeout } = start()
    clock.hold('focus', true)
    clock.hide(true)
    clock.hide(false)
    expect(clock.view()).toEqual({ running: false, round: 1 })
    clock.hold('focus', false)
    vi.advanceTimersByTime(MS)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('says each change once and nothing when there is none', () => {
    const { clock, views } = start()
    clock.hold('pointer', true)
    clock.hold('focus', true)
    clock.hold('pointer', false)
    clock.hold('focus', false)
    expect(views).toEqual([
      { running: false, round: 0 },
      { running: true, round: 0 },
    ])
  })

  it('does nothing more once closed: a close during the exit fires no timeout', () => {
    const { clock, onTimeout, views } = start()
    vi.advanceTimersByTime(5_000)
    clock.stop()
    expect(clock.view().running).toBe(false)
    clock.hold('pointer', true)
    clock.hold('pointer', false)
    clock.hide(true)
    clock.hide(false)
    vi.advanceTimersByTime(MS * 2)
    expect(onTimeout).not.toHaveBeenCalled()
    expect(views).toEqual([{ running: false, round: 0 }])
  })

  it('times out once: the toast leaving after it, a hover or the tab coming back start nothing', () => {
    const { clock, onTimeout } = start()
    vi.advanceTimersByTime(MS)
    clock.hold('pointer', true)
    clock.hold('pointer', false)
    clock.hide(true)
    clock.hide(false)
    clock.stop()
    vi.advanceTimersByTime(MS * 2)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(clock.view().running).toBe(false)
  })
})
