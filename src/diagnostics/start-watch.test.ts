import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { profileSecondsOf, stallLine, watchLoopDelay, type DelayHistogram } from './start-watch.js'

const MS = 1e6

function fakeHistogram(windows: Array<{ max: number; p99: number }>): DelayHistogram & { resets: number; disabled: boolean } {
  let index = 0
  return {
    resets: 0,
    disabled: false,
    enable() { },
    disable() { this.disabled = true },
    get max() { return (windows[index]?.max ?? 0) * MS },
    percentile() { return (windows[index]?.p99 ?? 0) * MS },
    reset() {
      this.resets += 1
      index += 1
    },
  }
}

describe('stallLine', () => {
  it('says nothing for a window whose longest delay is under the threshold', () => {
    expect(stallLine({ max: 999, p99: 400 }, 5_000, 1_000)).toBeUndefined()
  })

  it('names the longest delay and the p99 of a window over the threshold', () => {
    expect(stallLine({ max: 12_368.4, p99: 9_001 }, 5_000, 1_000)).toBe('event loop: blocked up to 12368 ms in the last 5 s (p99 9001 ms)')
  })
})

describe('watchLoopDelay', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('logs only the windows over the threshold and stops after its time with a summary', () => {
    const histogram = fakeHistogram([{ max: 30, p99: 20 }, { max: 4_000, p99: 3_500 }, { max: 50, p99: 40 }])
    const lines: string[] = []
    watchLoopDelay({ forMs: 15_000, everyMs: 5_000, thresholdMs: 1_000, log: (line) => lines.push(line), histogram })

    vi.advanceTimersByTime(15_000)
    expect(lines).toEqual([
      'event loop: blocked up to 4000 ms in the last 5 s (p99 3500 ms)',
      'event loop: the first 15 s had 1 window over 1000 ms, the longest 4000 ms',
    ])
    expect(histogram.disabled).toBe(true)

    vi.advanceTimersByTime(30_000)
    expect(lines).toHaveLength(2)
  })

  it('stays silent through a calm start', () => {
    const histogram = fakeHistogram([{ max: 30, p99: 20 }, { max: 40, p99: 20 }])
    const lines: string[] = []
    watchLoopDelay({ forMs: 10_000, everyMs: 5_000, thresholdMs: 1_000, log: (line) => lines.push(line), histogram })
    vi.advanceTimersByTime(10_000)
    expect(lines).toEqual([])
    expect(histogram.disabled).toBe(true)
  })
})

describe('profileSecondsOf', () => {
  it('takes a positive whole number of seconds and caps it at ten minutes', () => {
    expect(profileSecondsOf({ EVEN_KEEL_CPU_PROFILE: '90' })).toBe(90)
    expect(profileSecondsOf({ EVEN_KEEL_CPU_PROFILE: '7200' })).toBe(600)
  })

  it('profiles nothing without the variable or with a value that is not a positive number', () => {
    expect(profileSecondsOf({})).toBeUndefined()
    expect(profileSecondsOf({ EVEN_KEEL_CPU_PROFILE: '' })).toBeUndefined()
    expect(profileSecondsOf({ EVEN_KEEL_CPU_PROFILE: '0' })).toBeUndefined()
    expect(profileSecondsOf({ EVEN_KEEL_CPU_PROFILE: 'yes' })).toBeUndefined()
  })
})
