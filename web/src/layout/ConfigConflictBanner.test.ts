import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import type { ConfigConflictView, EvenKeelState } from '../../../src/state.js'
import { conflictMark, conflictsShown } from './ConfigConflictBanner.js'

const conflict = (file: string, hash: string): ConfigConflictView => ({
  file, machine: null, since: '2026-11-26T10:00:00Z', notice: notice('memory.configConflictAnywhere', { file }), hash, kept: 'a', other: 'b',
})

const state = (conflicts: ConfigConflictView[], patch: { notices?: Record<string, boolean>; dismissed?: Record<string, string> } = {}) =>
  ({ configConflicts: conflicts, config: { shared: { notices: patch.notices ?? {} }, projects: {} }, noticesDismissed: patch.dismissed ?? {} }) as unknown as EvenKeelState

describe('conflictsShown', () => {
  const settings = conflict('settings.json', 'h1')
  const hook = conflict('hooks/guard.mjs', 'h2')

  it('shows every open conflict by default', () => {
    expect(conflictsShown(state([settings, hook]))).toEqual([settings, hook])
    expect(conflictsShown(null)).toEqual([])
  })

  it('"Got it" hides a file\'s conflict until the next one of that file', () => {
    const dismissed = { [conflictMark(settings)]: 'h1' }
    expect(conflictsShown(state([settings, hook], { dismissed }))).toEqual([hook])
    const next = conflict('settings.json', 'h3')
    expect(conflictsShown(state([next, hook], { dismissed }))).toEqual([next, hook])
  })

  it('a kind turned off hides them all, and turned back on shows them again', () => {
    expect(conflictsShown(state([settings, hook], { notices: { 'config.conflict': false } }))).toEqual([])
    expect(conflictsShown(state([settings, hook], { notices: { 'config.conflict': true } }))).toEqual([settings, hook])
  })
})
