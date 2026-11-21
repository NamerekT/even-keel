import { describe, expect, it } from 'vitest'
import { chatEdits } from './chatEdits.js'

const diffs = { p1: { 'ABC-1': { added: 720, removed: 89 }, 'ABC-2': { added: 0, removed: 0 } } }
const task = { key: 'ABC-1', project: 'p1' }

describe('chatEdits', () => {
  it('counts a task chat by its branch, whatever its session edited', () => {
    expect(chatEdits(diffs, task, { added: 3, removed: 1 })).toEqual({ added: 720, removed: 89, of: 'branch' })
  })

  it('shows the same after a handoff, when the new session has edited nothing yet', () => {
    const before = chatEdits(diffs, task, { added: 650, removed: 80 })
    expect(chatEdits(diffs, task, null)).toEqual(before)
  })

  it('shows nothing for a branch with no change, not the session’s edits', () => {
    expect(chatEdits(diffs, { key: 'ABC-2', project: 'p1' }, { added: 3, removed: 1 })).toBeNull()
  })

  it('counts the session where no branch is read: a project chat, a fix of main, a folder gone or an older service', () => {
    const own = { added: 3, removed: 1 }
    expect(chatEdits(diffs, { key: 'chat' }, own)).toEqual({ ...own, of: 'session' })
    expect(chatEdits({ p1: { 'ABC-FIX': { added: 9, removed: 9 } } }, { key: 'ABC-FIX', project: 'p1' }, own)).toEqual({ ...own, of: 'session' })
    expect(chatEdits(diffs, { key: 'ABC-3', project: 'p1' }, own)).toEqual({ ...own, of: 'session' })
    expect(chatEdits(undefined, task, own)).toEqual({ ...own, of: 'session' })
    expect(chatEdits(undefined, task, null)).toBeNull()
  })
})
