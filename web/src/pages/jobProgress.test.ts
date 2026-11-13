import { describe, expect, it } from 'vitest'
import { progressText, stepTime } from './jobProgress.js'

describe('progressText', () => {
  it.each([
    [{ stage: 'connecting' as const }, 'connecting…'],
    [{ stage: 'enumerating' as const, objects: 1234567 }, 'the server lists objects: 1,234,567'],
    [{ stage: 'counting' as const, percent: 30 }, 'counting objects · 30%'],
    [{ stage: 'receiving' as const, percent: 42, bytes: 2048, speed: 1024 }, 'receiving · 42% · 2 KB · 1 KB/s'],
    [{ stage: 'lfs' as const, percent: 63 }, '63%'],
  ])('says %j as %s', (progress, text) => {
    expect(progressText(progress)).toBe(text)
  })
})

describe('stepTime', () => {
  const now = new Date('2026-11-13T10:01:32Z')

  it('counts a running step up to now', () => {
    expect(stepTime({ id: 'clone', state: 'running', startedAt: '2026-11-13T10:00:00Z' }, now)).toBe('1:32')
  })

  it('keeps a finished step at its own length, and leaves out one shorter than a second', () => {
    expect(stepTime({ id: 'clone', state: 'done', startedAt: '2026-11-13T10:00:00Z', endedAt: '2026-11-13T10:00:07Z' }, now)).toBe('0:07')
    expect(stepTime({ id: 'trust', state: 'done', startedAt: '2026-11-13T10:00:00Z', endedAt: '2026-11-13T10:00:00.400Z' }, now)).toBeNull()
  })

  it('has no time for a step that has not begun', () => {
    expect(stepTime({ id: 'packages', state: 'waiting' }, now)).toBeNull()
  })
})
