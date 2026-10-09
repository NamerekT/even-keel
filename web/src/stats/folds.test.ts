import { describe, expect, it } from 'vitest'
import { foldText, parseFolds, withFold } from './folds.js'

describe('parseFolds', () => {
  it('keeps every section folded when nothing is saved', () => {
    expect(parseFolds(null)).toEqual([])
  })

  it('reads the open sections and drops what it does not know', () => {
    expect(parseFolds('tasks,stuck,weather,tasks')).toEqual(['tasks', 'stuck'])
  })
})

describe('withFold', () => {
  it('opens a section and folds it back', () => {
    expect(withFold(['tasks'], 'steps', true)).toEqual(['tasks', 'steps'])
    expect(withFold(['tasks', 'steps'], 'tasks', false)).toEqual(['steps'])
  })

  it('returns the same list when nothing changes', () => {
    const open = parseFolds('rules')
    expect(withFold(open, 'rules', true)).toBe(open)
    expect(withFold(open, 'tasks', false)).toBe(open)
  })

  it('survives a round trip through the saved text', () => {
    expect(parseFolds(foldText(withFold([], 'estimate', true)))).toEqual(['estimate'])
  })
})
