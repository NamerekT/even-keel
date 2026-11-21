import { describe, expect, it } from 'vitest'
import type { ImportState } from '../../../src/tracker/import-plan.js'
import { importPhaseOf } from './importPhase.js'

const none = { tasks: 0, created: 0, linked: 0, attached: 0, journaled: 0, done: 0 }
const from = { tracker: 'huly', place: 'ABC', key: 'ABC' }
const state = (over: Partial<ImportState> = {}): ImportState => ({
  from: null,
  authors: [],
  running: false,
  startedAt: null,
  finishedAt: null,
  progress: none,
  total: 0,
  failed: null,
  check: null,
  checkFailed: null,
  switching: null,
  ...over,
})
const all = (count: number) => ({ tasks: count, created: count, linked: count, attached: count, journaled: count, done: count })

describe('importPhaseOf', () => {
  it('reads the state first', () => {
    expect(importPhaseOf(null)).toBe('read')
  })

  it('shows the plan while no import began', () => {
    expect(importPhaseOf(state())).toBe('pick')
  })

  it('follows a running import', () => {
    expect(importPhaseOf(state({ from, running: true, total: 12, progress: { ...none, tasks: 3, created: 2 } }))).toBe('running')
  })

  it('offers to go on with an import that stopped, failed or lost to a restart', () => {
    expect(importPhaseOf(state({ from, total: 12, progress: { ...none, tasks: 5, created: 5 }, failed: { code: 'import.failed', params: { tracker: 'Huly' } } }))).toBe('resume')
    expect(importPhaseOf(state({ from, total: 12, progress: { ...none, tasks: 5, created: 5 } }))).toBe('resume')
    expect(importPhaseOf(state({ from, total: 12 }))).toBe('resume')
  })

  it('is finished once every task is through to the end', () => {
    expect(importPhaseOf(state({ from, total: 12, progress: all(12), finishedAt: '2026-11-21T10:00:00.000Z' }))).toBe('finished')
  })

  it('follows a switch while it goes', () => {
    expect(importPhaseOf(state({ from, total: 12, progress: all(12), finishedAt: '2026-11-21T10:00:00.000Z', switching: { stage: 'check', done: 3, total: 12 } }))).toBe('switching')
  })

  it('goes on after a stop past the end of the run, when the last pass failed', () => {
    expect(importPhaseOf(state({ from, total: 12, progress: all(12), finishedAt: '2026-11-21T10:00:00.000Z', failed: { code: 'import.failed', params: { tracker: 'Huly' } } }))).toBe('resume')
  })
})
