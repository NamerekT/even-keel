import { describe, expect, it } from 'vitest'
import { currentRunOf, medianDuration, runDurationMs, STUCK_MS, stuckSince, taskIdsOf, type CiRun } from './model.js'

const NOW = new Date('2026-10-12T12:00:00Z')

function run(id: number, overrides: Partial<CiRun> = {}): CiRun {
  return {
    id,
    number: id,
    title: `run ${id}`,
    workflow: 'test.yml',
    commit: `sha${id}`,
    status: 'success',
    createdAt: '2026-10-12T11:00:00Z',
    startedAt: '2026-10-12T11:00:10Z',
    stoppedAt: '2026-10-12T11:03:10Z',
    url: `https://ci.example.com/runs/${id}`,
    ...overrides,
  }
}

describe('runDurationMs', () => {
  it('counts from the runner taking it to the stop', () => {
    expect(runDurationMs(run(1), NOW)).toBe(180_000)
  })

  it('counts a running run up to now', () => {
    expect(runDurationMs(run(1, { status: 'running', startedAt: '2026-10-12T11:57:20Z', stoppedAt: null }), NOW)).toBe(160_000)
  })

  it('has no length while queued', () => {
    expect(runDurationMs(run(1, { status: 'queued', startedAt: null, stoppedAt: null }), NOW)).toBeNull()
  })

  it('takes the creation when a finished run has no start', () => {
    expect(runDurationMs(run(1, { startedAt: null }), NOW)).toBe(190_000)
  })
})

describe('medianDuration', () => {
  it('is the middle of finished runs, cancelled ones aside', () => {
    const runs = [
      run(1, { stoppedAt: '2026-10-12T11:02:10Z' }),
      run(2, { status: 'failure', stoppedAt: '2026-10-12T11:04:10Z' }),
      run(3, { status: 'cancelled', stoppedAt: '2026-10-12T11:00:20Z' }),
      run(4),
    ]
    expect(medianDuration(runs, NOW)).toBe(180_000)
  })

  it('averages the two middle ones of an even count', () => {
    expect(medianDuration([run(1, { stoppedAt: '2026-10-12T11:02:10Z' }), run(2)], NOW)).toBe(150_000)
  })

  it('is unknown without finished runs', () => {
    expect(medianDuration([run(1, { status: 'running', stoppedAt: null })], NOW)).toBeNull()
  })
})

describe('currentRunOf', () => {
  it('is the newest unfinished run', () => {
    expect(currentRunOf([run(3), run(2, { status: 'running' }), run(1, { status: 'queued' })])?.id).toBe(2)
  })

  it('is the newest run when all are finished', () => {
    expect(currentRunOf([run(3), run(2)])?.id).toBe(3)
    expect(currentRunOf([])).toBeNull()
  })
})

describe('stuckSince', () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

  it('flags a run queued too long', () => {
    const queued = run(1, { status: 'queued', createdAt: at(STUCK_MS), startedAt: null, stoppedAt: null })
    expect(stuckSince({ current: { run: queued, tasks: [], jobs: [] }, pushed: null }, NOW)).toBe(queued.createdAt)
  })

  it('lets a fresh queue and a running run be', () => {
    const queued = run(1, { status: 'queued', createdAt: at(STUCK_MS - 1_000), startedAt: null, stoppedAt: null })
    expect(stuckSince({ current: { run: queued, tasks: [], jobs: [] }, pushed: null }, NOW)).toBeNull()
    const running = run(1, { status: 'running', createdAt: at(STUCK_MS * 3), stoppedAt: null })
    expect(stuckSince({ current: { run: running, tasks: [], jobs: [] }, pushed: null }, NOW)).toBeNull()
  })

  it('flags a push no run has taken', () => {
    expect(stuckSince({ current: null, pushed: { commit: 'abc', at: at(STUCK_MS) } }, NOW)).toBe(at(STUCK_MS))
    expect(stuckSince({ current: null, pushed: { commit: 'abc', at: at(1_000) } }, NOW)).toBeNull()
  })
})

describe('taskIdsOf', () => {
  it('takes the ids in brackets once each', () => {
    expect(taskIdsOf(['[BTN-102] CI panel', "Merge branch 'btn-102/task'", '[BTN-102] Docs', '[CBL-7] Fix'])).toEqual(['BTN-102', 'CBL-7'])
  })
})
