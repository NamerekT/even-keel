import { describe, expect, it } from 'vitest'
import { notice } from '../notice/notice.js'
import type { CiRun, CiView } from './model.js'
import { verdictOf } from './verdict.js'

const PUSHED = '2026-10-12T12:00:00Z'
const SOON = new Date('2026-10-12T12:01:00Z')
const LATE = new Date('2026-10-12T12:05:00Z')

function run(id: number, overrides: Partial<CiRun> = {}): CiRun {
  return {
    id,
    number: id,
    title: `run ${id}`,
    workflow: 'test.yml',
    commit: 'B',
    status: 'success',
    createdAt: '2026-10-12T12:00:05Z',
    startedAt: '2026-10-12T12:00:10Z',
    stoppedAt: '2026-10-12T12:03:00Z',
    url: `https://ci.example.com/runs/${id}`,
    ...overrides,
  }
}

function view(history: CiRun[], overrides: Partial<CiView> = {}): CiView {
  return {
    kind: 'forgejo',
    remote: 'origin',
    url: 'https://ci.example.com/runs',
    health: 'ok',
    error: null,
    checkedAt: SOON.toISOString(),
    current: null,
    history,
    medianMs: null,
    pushed: null,
    ...overrides,
  }
}

describe('verdictOf', () => {
  it('has nothing to say without a CI', () => {
    expect(verdictOf([], 'B', PUSHED, SOON)).toEqual({ state: 'none' })
  })

  it('is green when every run of the commit passed', () => {
    expect(verdictOf([view([run(2, { workflow: 'lint.yml' }), run(1), run(0, { commit: 'A', status: 'failure' })])], 'B', PUSHED, SOON)).toEqual({ state: 'green' })
  })

  it('takes a cancelled or skipped run for a pass', () => {
    expect(verdictOf([view([run(2, { status: 'cancelled' }), run(1, { status: 'skipped' })])], 'B', PUSHED, SOON)).toEqual({ state: 'green' })
  })

  it('is red once a run of the commit fails, even while another still runs', () => {
    const failed = run(1, { status: 'failure' })
    const verdict = verdictOf([view([run(2, { status: 'running', stoppedAt: null }), failed])], 'B', PUSHED, SOON)
    expect(verdict).toEqual({ state: 'red', failed: [{ kind: 'forgejo', run: failed }] })
  })

  it('waits while a run of the commit is unfinished', () => {
    expect(verdictOf([view([run(1, { status: 'running', stoppedAt: null })])], 'B', PUSHED, SOON)).toEqual({ state: 'pending' })
  })

  it('waits for a run of a fresh push to show up', () => {
    expect(verdictOf([view([run(1, { commit: 'A' })])], 'B', PUSHED, SOON)).toEqual({ state: 'pending' })
  })

  it('gives up on a push no run took in time', () => {
    const verdict = verdictOf([view([run(1, { commit: 'A' })])], 'B', PUSHED, LATE)
    expect(verdict).toEqual({ state: 'unavailable', reasons: [notice('ci.notTaken', { ci: 'Forgejo', commit: 'B' })] })
  })

  it('gives up on a run queued too long while the runner is idle', () => {
    const queued = run(1, { status: 'queued', startedAt: null, stoppedAt: null })
    expect(verdictOf([view([queued])], 'B', PUSHED, LATE).state).toBe('unavailable')
  })

  it('waits for a queued run while the runner works on another', () => {
    const queued = run(2, { status: 'queued', startedAt: null, stoppedAt: null })
    const busy = run(1, { commit: 'A', status: 'running', stoppedAt: null })
    expect(verdictOf([view([queued, busy])], 'B', PUSHED, LATE)).toEqual({ state: 'pending' })
  })

  it('does not wait for a CI without a token or whose API fails', () => {
    const off = view([], { health: 'off', error: notice('ci.noToken', { variable: 'FORGEJO_TOKEN' }) })
    expect(verdictOf([off], 'B', PUSHED, SOON)).toEqual({ state: 'unavailable', reasons: [notice('ci.noToken', { variable: 'FORGEJO_TOKEN' })] })
  })

  it('finds the run of the commit in the current run as well', () => {
    const current = run(1, { status: 'failure' })
    const verdict = verdictOf([view([], { current: { run: current, tasks: [], jobs: [] } })], 'B', PUSHED, SOON)
    expect(verdict.state).toBe('red')
  })

  it('puts red before waiting, waiting before unavailable, and unavailable before green across CIs', () => {
    const green = view([run(1)])
    const pending = view([run(1, { status: 'running', stoppedAt: null })], { kind: 'github' })
    const red = view([run(1, { status: 'failure' })], { kind: 'github' })
    const off = view([], { health: 'error', error: notice('ci.unreachable', { ci: 'GitHub Actions' }) })
    expect(verdictOf([pending, red], 'B', PUSHED, SOON).state).toBe('red')
    expect(verdictOf([off, pending], 'B', PUSHED, SOON).state).toBe('pending')
    expect(verdictOf([green, off], 'B', PUSHED, SOON).state).toBe('unavailable')
  })
})
