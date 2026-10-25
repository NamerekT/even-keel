import { describe, expect, it } from 'vitest'
import { backlog, setup, task } from './dispatcher.fixture.js'

const v1 = { label: 'v0.1', targetDate: null }
const v2 = { label: 'v0.2', targetDate: null }

describe('milestone landing preview', () => {
  it.each([true, false])('previews the active milestone only while filling is enabled (%s)', (fillMilestone) => {
    const { dispatcher } = setup({ fillMilestone })
    dispatcher.setTasks('ABC', [
      { ...task('ABC-1'), milestone: v1, priority: 'high' },
      { ...task('ABC-2'), milestone: v1, priority: 'low' },
      { ...task('ABC-3'), milestone: v2 },
      { ...task('ABC-4', backlog), priority: 'medium' },
    ])
    const order = dispatcher.orders().ABC!
    expect(order.landing?.['ABC-4']).toBe(fillMilestone ? 'ABC-2' : null)
    expect(order.landingMilestones?.['ABC-4']).toEqual(fillMilestone ? v1 : undefined)
    expect(dispatcher.view('ABC').tasks.map((each) => each.milestone)).toEqual([v1, v1, v2])
  })

  it('takes the current task as donor and keeps an existing milestone', async () => {
    const { dispatcher } = setup({ fillMilestone: true })
    dispatcher.setTasks('ABC', [{ ...task('ABC-1'), milestone: v2 }])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [
      { ...task('ABC-1'), milestone: v2 },
      { ...task('ABC-2'), milestone: v1 },
      task('ABC-3', backlog),
      { ...task('ABC-4', backlog), milestone: v1 },
    ])
    expect(dispatcher.orders().ABC?.landingMilestones).toEqual({ 'ABC-3': v2 })
  })

  it('leaves the preview without a milestone when a later blocker prevents filling', () => {
    const { dispatcher } = setup({ fillMilestone: true })
    dispatcher.setTasks('ABC', [
      { ...task('ABC-1'), milestone: v1 },
      { ...task('ABC-2'), milestone: v2 },
      task('ABC-3', backlog, 'ABC-2'),
    ])
    expect(dispatcher.orders().ABC?.landing?.['ABC-3']).toBeNull()
    expect(dispatcher.orders().ABC?.landingMilestones).toBeUndefined()
  })

  it('checks blockers still outside the chain before previewing a filled milestone', () => {
    const { dispatcher } = setup({ fillMilestone: true })
    dispatcher.setTasks('ABC', [
      { ...task('ABC-1'), milestone: v1 },
      task('ABC-2', backlog, 'ABC-3'),
      { ...task('ABC-3', backlog), milestone: v2 },
      task('ABC-4', undefined, 'ABC-3'),
    ])
    expect(dispatcher.orders().ABC?.landingMilestones?.['ABC-2']).toBeUndefined()
  })

  it('has no milestone to preview in a chain without milestones', () => {
    const { dispatcher } = setup({ fillMilestone: true })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', backlog)])
    expect(dispatcher.orders().ABC?.landingMilestones).toBeUndefined()
  })

  it('applies a changed filling setting to the next preview without another tracker read', () => {
    const options = { fillMilestone: false }
    const { dispatcher } = setup(options)
    dispatcher.setTasks('ABC', [{ ...task('ABC-1'), milestone: v1 }, task('ABC-2', backlog)])
    expect(dispatcher.orders().ABC?.landingMilestones).toBeUndefined()
    options.fillMilestone = true
    expect(dispatcher.orders().ABC?.landingMilestones).toEqual({ 'ABC-2': v1 })
    options.fillMilestone = false
    expect(dispatcher.orders().ABC?.landingMilestones).toBeUndefined()
  })
})
