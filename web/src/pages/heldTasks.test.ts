import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import { heldTasksOf, taskParts } from './heldTasks.js'

describe('the tasks of a held switch', () => {
  it('are the held task, the released ones and those with open pull requests; a running chain names none', () => {
    expect(heldTasksOf(notice('switch.current', { task: 'ABC-1' }))).toEqual(['ABC-1'])
    expect(heldTasksOf(notice('switch.released', { tasks: ['ABC-2', 'ABC-3'] }))).toEqual(['ABC-2', 'ABC-3'])
    expect(heldTasksOf(notice('switch.reviews', { tasks: ['ABC-4'] }))).toEqual(['ABC-4'])
    expect(heldTasksOf(notice('switch.chainRuns', {}))).toEqual([])
  })

  it('cut the text at each id in place, never at an id inside a longer one', () => {
    expect(taskParts('released: ABC-12, ABC-1; finish them', ['ABC-1', 'ABC-12'])).toEqual([
      { text: 'released: ' },
      { text: 'ABC-12', task: 'ABC-12' },
      { text: ', ' },
      { text: 'ABC-1', task: 'ABC-1' },
      { text: '; finish them' },
    ])
    expect(taskParts('the chain holds ABC-1', [])).toEqual([{ text: 'the chain holds ABC-1' }])
  })
})
