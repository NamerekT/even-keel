import { describe, expect, it } from 'vitest'
import { notice, textNotice } from '../../../src/notice/notice.js'
import { projectErrors } from './noticeGroups.js'

describe('projectErrors', () => {
  const later = () => notice('order.later', { task: 'ABC-10', milestone: 'v0.2', blocker: 'ABC-21', blockerMilestone: 'v0.3' })

  it('shows the same ordering and pause reason once after serialization', () => {
    expect(projectErrors(later(), { kind: 'paused', error: later() })).toEqual([later()])
  })

  it('keeps distinct ordering and pause reasons', () => {
    const error = textNotice('A different pause reason')
    expect(projectErrors(later(), { kind: 'paused', error })).toEqual([error, later()])
  })

  it('keeps a pause reason when the order is valid', () => {
    const error = notice('git.noBranch', { project: 'ABC', branch: 'trunk', repo: 'D:/work/abc' })
    expect(projectErrors(null, { kind: 'paused', error })).toEqual([error])
  })

  it('keeps an ordering error without an active pause reason', () => {
    expect(projectErrors(later(), { kind: 'idle' })).toEqual([later()])
    expect(projectErrors(later(), { kind: 'paused', error: null })).toEqual([later()])
  })

  it('shows no error for a valid order and a chain without a pause reason', () => {
    expect(projectErrors(null, { kind: 'running', limitUntil: null })).toEqual([])
    expect(projectErrors(null, { kind: 'paused', error: null })).toEqual([])
  })
})
