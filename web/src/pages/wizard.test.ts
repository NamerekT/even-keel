import { describe, expect, it } from 'vitest'
import { checkMarks, filledShare, listSummary, stepMarks } from './wizard.js'

const STEPS = ['language', 'agent', 'tracker', 'stats', 'project'] as const

describe('stepMarks', () => {
  it('marks the steps before the current one done and those after it future', () => {
    expect(stepMarks(STEPS, 'tracker')).toEqual(['done', 'done', 'current', 'future', 'future'])
  })

  it('has nothing done on the first step and nothing future on the last', () => {
    expect(stepMarks(STEPS, 'language')).toEqual(['current', 'future', 'future', 'future', 'future'])
    expect(stepMarks(STEPS, 'project')).toEqual(['done', 'done', 'done', 'done', 'current'])
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
