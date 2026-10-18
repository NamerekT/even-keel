import { describe, expect, it } from 'vitest'
import { ResumeHolds } from './holds.js'

describe('ResumeHolds', () => {
  let now = 0
  const clock = () => now

  it('holds the session while the resume runs and until it is live again', async () => {
    now = 0
    const holds = new ResumeHolds(clock)
    let finish: (id: string) => void = () => {}
    const resumed = holds.during('s1', () => new Promise<string>((resolve) => (finish = resolve)))
    expect(holds.held('s1')).toBe(true)
    holds.sweep(() => true)
    expect(holds.held('s1')).toBe(true)
    finish('s1')
    await resumed
    holds.sweep(() => false)
    expect(holds.held('s1')).toBe(true)
    holds.sweep(() => true)
    expect(holds.held('s1')).toBe(false)
  })

  it('lets go of a session the resume failed on or replaced with a copy', async () => {
    now = 0
    const holds = new ResumeHolds(clock)
    await expect(holds.during('s1', () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(holds.held('s1')).toBe(false)
    expect(await holds.during('s2', async () => 'copy')).toBe('copy')
    expect(holds.held('s2')).toBe(false)
  })

  it('lets go of a resumed session that never comes up live', async () => {
    now = 0
    const holds = new ResumeHolds(clock)
    await holds.during('s1', async () => 's1')
    now = 61_000
    expect(holds.held('s1')).toBe(false)
  })
})
