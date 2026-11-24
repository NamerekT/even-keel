import { describe, expect, it } from 'vitest'
import type { BlockLamp } from '../state.js'
import { firstGroup, groupTone, runningGroup } from './runningGroup.js'

const row = (id: string, current: boolean, lamp: BlockLamp = current ? 'working' : 'ahead') => ({ id, current, lamp })

describe('runningGroup', () => {
  it('holds the running, asking and failed lane tasks together', () => {
    const rows = [row('A-1', false, 'done'), row('A-2', true), row('A-3', true, 'waiting'), row('A-4', true, 'error'), row('A-5', false)]
    expect(runningGroup(rows)?.members).toEqual(['A-2', 'A-3', 'A-4'])
  })

  it('leaves out a task its lane let go, a closed one and one in the queue', () => {
    const rows = [row('A-1', false, 'done'), row('A-2', true), row('A-3', false, 'stopped'), row('A-4', true), row('A-5', false)]
    expect(runningGroup(rows)?.members).toBeUndefined()
  })

  it('is no group for one running task', () => {
    expect(runningGroup([row('A-1', true), row('A-2', false)])).toBeNull()
    expect(runningGroup([row('A-1', false)])).toBeNull()
  })

  it('takes the first unbroken run only', () => {
    const rows = [row('A-1', true), row('A-2', true), row('A-3', false), row('A-4', true)]
    expect(runningGroup(rows)?.members).toEqual(['A-1', 'A-2'])
  })
})

describe('firstGroup', () => {
  it('takes the group of the first section that has one', () => {
    const sections = [[row('A-1', true), row('A-2', false)], [row('A-3', true), row('A-4', true)]]
    expect(firstGroup(sections)?.members).toEqual(['A-3', 'A-4'])
    expect(firstGroup([[row('A-1', true)], [row('A-2', true)]])).toBeNull()
  })
})

describe('groupTone', () => {
  it('puts an error over a question and a question over work', () => {
    expect(groupTone([row('A-1', true), row('A-2', true)])).toBe('working')
    expect(groupTone([row('A-1', true), row('A-2', true, 'waiting')])).toBe('waiting')
    expect(groupTone([row('A-1', true, 'waiting'), row('A-2', true, 'error')])).toBe('error')
    expect(groupTone([row('A-1', true, 'limit'), row('A-2', true, 'waiting')])).toBe('error')
  })
})
