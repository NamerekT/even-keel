import { describe, expect, it } from 'vitest'
import { focusAfterClose, focusOnEntry } from './focus.js'

const block = (id: string, open: boolean) => ({ id, open })

describe('focusOnEntry', () => {
  const entry = (id: string, current: boolean, session: boolean, locked = false) => ({
    id,
    current,
    locked,
    session: session ? {} : null,
    start: null,
  })
  const chain = [entry('A-1', false, true), entry('A-2', true, true), entry('A-3', false, false)]

  it('opens the session of the current task when the address names nothing', () => {
    expect(focusOnEntry(chain, '')).toBe('A-2')
  })

  it('leaves alone an address that names a task or a panel', () => {
    expect(focusOnEntry(chain, 'A-3')).toBeNull()
    expect(focusOnEntry(chain, 'backlog')).toBeNull()
  })

  it('opens nothing without a current session', () => {
    expect(focusOnEntry([entry('A-1', false, true), entry('A-2', false, false)], '')).toBeNull()
    expect(focusOnEntry([entry('A-1', true, false)], '')).toBeNull()
    expect(focusOnEntry([entry('A-1', true, true, true)], '')).toBeNull()
  })

  it('opens the current task whose session is only starting', () => {
    expect(focusOnEntry([{ ...entry('A-1', true, false), start: {} }], '')).toBe('A-1')
  })
})

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
