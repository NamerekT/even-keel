import { describe, expect, it } from 'vitest'
import { Activity } from './activity.js'

describe('Activity', () => {
  it('counts the work in flight and lets go of it when it ends, whatever the outcome', async () => {
    const activity = new Activity()
    let finish!: () => void
    let fail!: (reason: Error) => void
    const first = activity.track(new Promise<void>((resolve) => (finish = resolve)))
    const second = activity.track(new Promise<void>((_, reject) => (fail = reject)))
    expect(activity.running()).toBe(2)

    finish()
    await first
    expect(activity.running()).toBe(1)

    fail(new Error('no answer'))
    await expect(second).rejects.toThrow('no answer')
    expect(activity.running()).toBe(0)
  })

  it('tells the listeners about every change until they leave', async () => {
    const activity = new Activity()
    const seen: number[] = []
    const leave = activity.subscribe(() => seen.push(activity.running()))

    await activity.track(Promise.resolve())
    leave()
    await activity.track(Promise.resolve())

    expect(seen).toEqual([1, 0])
  })

  it('hands the answer through', async () => {
    expect(await new Activity().track(Promise.resolve('answer'))).toBe('answer')
  })
})
