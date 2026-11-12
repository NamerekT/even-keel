import { describe, expect, it } from 'vitest'
import { checkMarks, filledShare, listSummary, stepMarks } from './wizard.js'

const STEPS = ['language', 'agent', 'tracker', 'stats', 'project'] as const

const line = (done: boolean[]) => STEPS.map((id, index) => ({ id, done: done[index]! }))

describe('stepMarks', () => {
  it('marks the current step a ring and the others by their answer, not by their place (BTN-1023)', () => {
    expect(stepMarks(line([true, false, false, true, false]), 'tracker')).toEqual(['done', 'future', 'current', 'done', 'future'])
  })

  it('leaves a step before the current one without its check while it has no answer', () => {
    expect(stepMarks(line([true, false, true, true, false]), 'project')).toEqual(['done', 'future', 'done', 'done', 'current'])
  })

  it('rings the current step even when it is answered', () => {
    expect(stepMarks(line([true, true, true, true, false]), 'language')).toEqual(['current', 'done', 'done', 'done', 'future'])
  })
})

describe('filledShare', () => {
  it('fills the line from the first dot to the current one', () => {
    expect(filledShare(STEPS, 'language')).toBe(0)
    expect(filledShare(STEPS, 'tracker')).toBe(0.5)
    expect(filledShare(STEPS, 'project')).toBe(1)
  })

  it('leaves a line of one step empty', () => {
    expect(filledShare(['only'], 'only')).toBe(0)
  })
})

describe('listSummary', () => {
  it('names the first item and counts the rest', () => {
    expect(listSummary(['GitHub · octo-org'])).toBe('GitHub · octo-org')
    expect(listSummary(['GitHub · octo-org', 'Huly · example', 'Linear · acme'])).toBe('GitHub · octo-org +2')
  })

  it('has no summary for no items', () => {
    expect(listSummary([])).toBeNull()
  })
})

describe('checkMarks', () => {
  it('rings the first step not filled in and leaves the later ones empty', () => {
    expect(checkMarks(['passed', 'empty', 'failed', 'empty'])).toEqual(['passed', 'current', 'failed', 'future'])
  })

  it('rings nothing once every step is filled in', () => {
    expect(checkMarks(['passed', 'failed'])).toEqual(['passed', 'failed'])
  })
})
