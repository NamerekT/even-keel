import { describe, expect, it } from 'vitest'
import type { Task } from '../../../src/tracker/model.js'
import { lineOf, linesText, pairOf, ruleChoicesOf, rowsOf, withoutListed } from './settingsRows.js'

describe('rows of a list field', () => {
  it('keeps an empty row being typed, and has none for an empty text', () => {
    expect(rowsOf('')).toEqual([])
    expect(rowsOf('a\n\nb')).toEqual(['a', '', 'b'])
  })

  it('joins rows back line by line', () => {
    expect(linesText(['a', '', 'b'])).toBe('a\n\nb')
    expect(linesText([])).toBe('')
  })
})

describe('a moved folder', () => {
  it('splits at the first arrow and trims both sides', () => {
    expect(pairOf('D:/old/abc  =>  D:/new/abc')).toEqual(['D:/old/abc', 'D:/new/abc'])
    expect(pairOf('a=>b=>c')).toEqual(['a', 'b=>c'])
  })

  it('takes a line without an arrow as the old path alone', () => {
    expect(pairOf(' D:/old ')).toEqual(['D:/old', ''])
  })

  it('writes a pair back as the config reads it', () => {
    expect(lineOf(['D:/old', 'D:/new'])).toBe('D:/old => D:/new')
    expect(pairOf(lineOf(['', 'D:/new']))).toEqual(['', 'D:/new'])
  })
})

describe('choices for the chain rules', () => {
  const task = (status: string, labels: string[]): Task =>
    ({ id: 'ABC-1', title: '', status: { name: status, category: 'ToDo' }, labels, blockedBy: [], parent: null, subtasks: 0, milestone: null, priority: 'none', estimate: null, question: false, models: [] }) as unknown as Task

  it('lists the statuses and labels the tasks have, once each, sorted', () => {
    expect(ruleChoicesOf([task('Todo', ['ui', 'Bug']), task('In Progress', ['ui']), task('Todo', [])])).toEqual({
      statuses: ['In Progress', 'Todo'],
      labels: ['Bug', 'ui'],
    })
  })

  it('does not offer a name the opposite list has, whatever its case and spaces', () => {
    expect(withoutListed(['Bug', 'Manual', 'ui'], ' manual \n\nUI')).toEqual(['Bug'])
    expect(withoutListed(['Bug'], '')).toEqual(['Bug'])
  })
})
