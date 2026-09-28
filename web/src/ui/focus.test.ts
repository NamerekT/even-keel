import { describe, expect, it } from 'vitest'
import { focusAfterClose } from './focus.js'

const block = (id: string, open: boolean) => ({ id, open })

describe('focusAfterClose', () => {
  const before = [block('A-1', false), block('A-2', true), block('A-3', true), block('A-4', true)]
  const after = [block('A-1', false), block('A-2', false), block('A-3', true), block('A-4', true)]

  it('moves the focus from a task that just closed to the next open one', () => {
    expect(focusAfterClose(before, after, 'A-2')).toBe('A-3')
  })

  it('keeps the focus on a task that did not close, or was closed already', () => {
    expect(focusAfterClose(before, after, 'A-3')).toBeNull()
    expect(focusAfterClose(before, after, 'A-1')).toBeNull()
    expect(focusAfterClose(before, after, '')).toBeNull()
  })

  it('keeps the focus when nothing open is left after the closed task', () => {
    expect(focusAfterClose([block('A-1', true)], [block('A-1', false)], 'A-1')).toBeNull()
  })
})
