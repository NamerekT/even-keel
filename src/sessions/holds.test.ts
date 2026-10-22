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

describe('ResumeHolds.turning', () => {
  let now = 0
  const clock = () => now
  const never = () => false

  it('counts the session mid-turn while it is resumed and until the daemon shows it working', async () => {
    now = 0
    const holds = new ResumeHolds(clock)
    let finish: (id: string) => void = () => {}
    const resumed = holds.during('s1', () => new Promise<string>((resolve) => (finish = resolve)))
    expect(holds.turning('s1', null)).toBe(true)
    holds.sweep(() => true, () => true)
    expect(holds.turning('s1', null)).toBe(true)
    finish('s1')
    await resumed
    now = 20_000
    holds.sweep(() => true, never)
    expect(holds.turning('s1', null)).toBe(true)
    holds.sweep(() => true, () => true)
    expect(holds.turning('s1', null)).toBe(false)
  })

  it('lets go once the window passes without the turn ever seen', async () => {
    now = 0
    const holds = new ResumeHolds(clock)
    await holds.during('s1', async () => 's1')
    now = 44_000
    expect(holds.turning('s1', null)).toBe(true)
    now = 46_000
    expect(holds.turning('s1', null)).toBe(false)
  })

  it('lets go once the session shows a question other than the one it had at the resume', async () => {
    now = 0
    const holds = new ResumeHolds(clock)
    await holds.during('s1', async () => 's1', 'old')
    expect(holds.turning('s1', 'old')).toBe(true)
    expect(holds.turning('s1', 'new')).toBe(false)
  })

  it('counts a copy the resume made mid-turn instead of the session it replaced', async () => {
    now = 0
    const holds = new ResumeHolds(clock)
    await holds.during('s1', async () => 'copy')
    expect(holds.turning('s1', null)).toBe(false)
    expect(holds.turning('copy', null)).toBe(true)
  })

  it('does not count a session whose resume failed', async () => {
    now = 0
    const holds = new ResumeHolds(clock)
    await expect(holds.during('s1', () => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(holds.turning('s1', null)).toBe(false)
  })
})
