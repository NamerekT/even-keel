import { describe, expect, it } from 'vitest'
import { runningBeforeRebuild } from './rebuild.js'
import type { UpdateRecord } from './model.js'

const live = 'ab'.repeat(20)
const older = 'cd'.repeat(20)
const state = { startedAt: '2026-11-01T12:00:10Z', updates: { current: '0.3.0', source: 'git' } }
const record: UpdateRecord = {
  mode: 'rebuild', from: { version: '0.3.0', commit: older, branch: 'dev', tag: null, storage: null }, to: null,
  startedAt: '2026-11-01T12:00:00Z', finishedAt: '2026-11-01T12:00:30Z', failed: null, rollback: null, seen: false,
}

describe('the hub that ran before the rebuild', () => {
  it('takes the commit announced to machines even when the last rebuild ran something else', () => {
    expect(runningBeforeRebuild({ ...state, hubCommit: live }, record)).toMatchObject({ commit: live, version: '0.3.0', legacy: false })
  })

  it('recognizes an older hub only from the successful rebuild that started this very process', () => {
    expect(runningBeforeRebuild(state, record)).toMatchObject({ commit: older, legacy: true })
    for (const previous of [null, { ...record, finishedAt: record.startedAt }, { ...record, failed: { step: 'build' as const, output: '' } }]) {
      expect(() => runningBeforeRebuild(state, previous)).toThrow(/running commit/)
    }
    expect(() => runningBeforeRebuild({ ...state, hubCommit: 'dev' }, record)).toThrow(/running commit/)
  })

  it('can retry after the first upgrade restored an older hub without hubCommit', () => {
    const previous = { ...record, to: { version: '0.3.1', tag: live }, failed: { step: 'answer' as const, output: 'timeout' }, rollback: { failed: null } }
    expect(runningBeforeRebuild(state, previous)).toMatchObject({ commit: older, legacy: true })
    expect(() => runningBeforeRebuild(state, { ...previous, rollback: null })).toThrow(/running commit/)
  })
})
