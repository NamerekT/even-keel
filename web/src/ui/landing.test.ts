import { describe, expect, it } from 'vitest'
import { landingIndex } from './landing.js'

const block = (id: string, locked = false) => ({ id, locked })

describe('landingIndex', () => {
  it('puts the task right before the one it will stand ahead of', () => {
    expect(landingIndex([block('ABC-1'), block('ABC-2'), block('ABC-3')], 'ABC-2')).toBe(1)
    expect(landingIndex([block('ABC-1'), block('ABC-2')], 'ABC-1')).toBe(0)
  })

  it('goes ahead of the locked blockers shown in front of that task', () => {
    const blocks = [block('ABC-1'), block('ABC-8', true), block('ABC-9', true), block('ABC-2'), block('ABC-3')]
    expect(landingIndex(blocks, 'ABC-2')).toBe(1)
  })

  it('goes to the end for no task or a task the list lacks', () => {
    const blocks = [block('ABC-1'), block('ABC-2')]
    expect(landingIndex(blocks, null)).toBe(2)
    expect(landingIndex(blocks, 'ABC-7')).toBe(2)
  })
})
