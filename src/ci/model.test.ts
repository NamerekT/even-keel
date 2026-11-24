import { describe, expect, it } from 'vitest'
import {
  currentRunOf,
  leadRun,
  medianDuration,
  mediansOf,
  pushesOf,
  pushStatus,
  runDurationMs,
  runOfJobs,
  STUCK_MS,
  stuckSince,
  broughtOf,
  pushLabel,
  taskIdsOf,
  waitingJobs,
  type CiJob,
  type CiRun,
  type CurrentRun,
} from './model.js'

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

describe('pushesOf', () => {
  it('puts the runs of one pushed commit together, one row per push', () => {
    const tests = run(748, { workflow: 'Tests', commit: 'B', event: 'push' })
    const macos = run(191, { workflow: 'macOS', commit: 'B', event: 'push' })
    const older = run(747, { workflow: 'Tests', commit: 'A', event: 'push' })
    expect(pushesOf([tests, macos, older]).map((push) => [push.commit, push.runs.map((each) => each.id)])).toEqual([
      ['B', [748, 191]],
      ['A', [747]],
    ])
  })

  it('gives a run without a push its own row, titled by its workflow', () => {
    const pushed = run(2, { workflow: 'Tests', commit: 'B', event: 'push', title: '[ABC-1] Export' })
    const manual = run(3, { workflow: 'Nightly', commit: 'B', event: 'manual', title: 'Nightly' })
    const pushes = pushesOf([manual, pushed])
    expect(pushes.map((push) => [push.title, push.manual, push.runs.length])).toEqual([
      ['Nightly', true, 1],
      ['[ABC-1] Export', false, 1],
    ])
    expect(pushes[0]!.key).not.toBe(pushes[1]!.key)
  })

  it('counts a pull request and a run of an unknown event as the push of their commit', () => {
    const pushes = pushesOf([run(1, { commit: 'B', event: 'pull' }), run(2, { commit: 'B' })])
    expect(pushes).toHaveLength(1)
  })
})

describe('pushStatus', () => {
  it('is red by a run that failed, whatever else is going on', () => {
    expect(pushStatus([run(1, { status: 'running' }), run(2, { status: 'failure' })])).toBe('failure')
  })

  it('is at work while any run is, before a queue', () => {
    expect(pushStatus([run(1), run(2, { status: 'queued' }), run(3, { status: 'running' })])).toBe('running')
    expect(pushStatus([run(1), run(2, { status: 'queued' })])).toBe('queued')
  })

  it('is not taken when a run failed only for want of a runner, never red', () => {
    expect(pushStatus([run(1), run(2, { status: 'failure', notTaken: true })])).toBe('notTaken')
  })

  it('is green when the rest is green, cancelled or skipped', () => {
    expect(pushStatus([run(1, { status: 'cancelled' }), run(2)])).toBe('success')
    expect(pushStatus([run(1, { status: 'skipped' }), run(2, { status: 'cancelled' })])).toBe('cancelled')
  })
})

describe('leadRun', () => {
  it('is the run at work expected to end last', () => {
    const tests = run(1, { workflow: 'Tests', status: 'running', startedAt: '2026-10-12T11:58:00Z', stoppedAt: null })
    const macos = run(2, { workflow: 'macOS', status: 'running', startedAt: '2026-10-12T11:59:00Z', stoppedAt: null })
    expect(leadRun([tests, macos], { Tests: 180_000, macOS: 600_000 }, NOW).id).toBe(2)
  })

  it('is the one still going over the finished ones', () => {
    const done = run(1, { stoppedAt: '2026-10-12T11:10:10Z' })
    const going = run(2, { status: 'queued', startedAt: null, stoppedAt: null })
    expect(leadRun([done, going], {}, NOW).id).toBe(2)
  })

  it('is the longest once all are over', () => {
    expect(leadRun([run(1), run(2, { stoppedAt: '2026-10-12T11:10:10Z' })], {}, NOW).id).toBe(2)
  })
})

describe('mediansOf', () => {
  it('keeps each workflow to its own runs', () => {
    const runs = [run(1, { workflow: 'Tests' }), run(2, { workflow: 'macOS', stoppedAt: '2026-10-12T11:10:10Z' }), run(3, { workflow: 'macOS', status: 'running', stoppedAt: null })]
    expect(mediansOf(runs, NOW)).toEqual({ Tests: 180_000, macOS: 600_000 })
  })
})

describe('stuckSince', () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
  const current = (...runs: CiRun[]): CurrentRun => ({ commit: runs[0]!.commit, title: runs[0]!.title, manual: false, tasks: [], runs: runs.map((each) => ({ run: each, jobs: [] })) })

  it('flags a run queued too long', () => {
    const queued = run(1, { status: 'queued', createdAt: at(STUCK_MS), startedAt: null, stoppedAt: null })
    expect(stuckSince({ current: current(queued), pushed: null }, NOW)).toBe(queued.createdAt)
  })

  it('flags a workflow of the push queued too long beside a finished one', () => {
    const queued = run(2, { status: 'queued', createdAt: at(STUCK_MS), startedAt: null, stoppedAt: null })
    expect(stuckSince({ current: current(run(1), queued), pushed: null }, NOW)).toBe(queued.createdAt)
  })

  it('lets a run queued behind a busy runner be', () => {
    const queued = run(1, { status: 'queued', createdAt: at(STUCK_MS * 3), startedAt: null, stoppedAt: null })
    expect(stuckSince({ current: current(queued), pushed: null, busy: { repository: 'john/demo', number: 12, url: 'https://ci.example.com/runs/12' } }, NOW)).toBeNull()
  })

  it('lets a fresh queue and a running run be', () => {
    const queued = run(1, { status: 'queued', createdAt: at(STUCK_MS - 1_000), startedAt: null, stoppedAt: null })
    expect(stuckSince({ current: current(queued), pushed: null }, NOW)).toBeNull()
    const running = run(1, { status: 'running', createdAt: at(STUCK_MS * 3), stoppedAt: null })
    expect(stuckSince({ current: current(running), pushed: null }, NOW)).toBeNull()
  })

  it('flags a push no run has taken', () => {
    expect(stuckSince({ current: null, pushed: { commit: 'abc', at: at(STUCK_MS) } }, NOW)).toBe(at(STUCK_MS))
    expect(stuckSince({ current: null, pushed: { commit: 'abc', at: at(1_000) } }, NOW)).toBeNull()
  })
})

describe('runOfJobs (BTN-1576)', () => {
  const queued = run(1, { status: 'queued', startedAt: null, stoppedAt: null })
  const job = (id: number, overrides: Partial<CiJob>): CiJob => ({ id, name: `job ${id}`, status: 'queued', startedAt: null, stoppedAt: null, steps: [], ...overrides })

  it('is at work once a runner took one of its jobs, though the CI calls the run queued while another waits', () => {
    const jobs = [
      job(1, { status: 'success', startedAt: '2026-10-12T11:00:20Z', stoppedAt: '2026-10-12T11:02:00Z' }),
      job(2, { status: 'running', startedAt: '2026-10-12T11:00:15Z' }),
      job(3, { status: 'queued' }),
    ]
    expect(runOfJobs(queued, jobs)).toEqual({ ...queued, status: 'running', startedAt: '2026-10-12T11:00:15Z' })
  })

  it('stays queued while no job got a runner: a skipped one or one given up never had one', () => {
    const jobs = [job(1, { status: 'skipped' }), job(2, { status: 'cancelled', notTaken: true }), job(3, { status: 'queued' })]
    expect(runOfJobs(queued, jobs)).toBe(queued)
    expect(runOfJobs(queued, [])).toBe(queued)
  })

  it('leaves a run the CI calls anything but queued as it is', () => {
    const failed = run(2, { status: 'failure' })
    expect(runOfJobs(failed, [job(1, { status: 'running' })])).toBe(failed)
  })
})

describe('waitingJobs (BTN-1576)', () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
  const job = (id: number, overrides: Partial<CiJob>): CiJob => ({ id, name: `job ${id}`, status: 'queued', startedAt: null, stoppedAt: null, steps: [], ...overrides })
  const push = (...runs: { run: CiRun; jobs: CiJob[] }[]): CurrentRun => ({ commit: 'sha1', title: 'run 1', manual: false, tasks: [], runs })

  it('names the jobs of a run at work that wait for a runner too long, with since when', () => {
    const running = run(1, { status: 'running', stoppedAt: null })
    const current = push({
      run: running,
      jobs: [job(1, { status: 'running' }), job(2, { name: 'test', waitingSince: at(STUCK_MS * 4) }), job(3, { name: 'lint', waitingSince: at(STUCK_MS - 1_000) })],
    })
    expect(waitingJobs(current, NOW)).toEqual([{ name: 'test', since: at(STUCK_MS * 4) }])
  })

  it('says nothing of a run still queued as a whole: the panel flags that run itself', () => {
    const queued = run(1, { status: 'queued', startedAt: null, stoppedAt: null })
    expect(waitingJobs(push({ run: queued, jobs: [job(1, { waitingSince: at(STUCK_MS * 4) })] }), NOW)).toEqual([])
    expect(waitingJobs(null, NOW)).toEqual([])
  })
})

describe('taskIdsOf', () => {
  it('takes the ids in brackets once each', () => {
    expect(taskIdsOf(['[BTN-102] CI panel', "Merge branch 'btn-102/task'", '[BTN-102] Docs', '[CBL-7] Fix'])).toEqual(['BTN-102', 'CBL-7'])
  })
})

describe('broughtOf', () => {
  it('takes the tasks of every subject and the subjects of the commits that are no merges (BTN-1586)', () => {
    const lines = ["p3 p4\tMerge remote-tracking branch 'origin/dev' into dev", 'p2\t[BTN-1573] Panel', "p1 p0\tMerge branch 'btn-1573/task' into dev", 'p0\tFix a typo', '']
    expect(broughtOf(lines)).toEqual({ tasks: ['BTN-1573'], subjects: ['[BTN-1573] Panel', 'Fix a typo'] })
  })

  it('keeps a tab inside a subject and reads a root commit as no merge', () => {
    expect(broughtOf(['\tFirst\tcommit'])).toEqual({ tasks: [], subjects: ['First\tcommit'] })
  })
})

describe('pushLabel', () => {
  it('names the tasks the push brought, once each, without its merges', () => {
    expect(pushLabel("Merge remote-tracking branch 'origin/dev' into dev", ['[BTN-1573] Panel', '[BTN-1578] Docs', '[BTN-1573] Tests'])).toEqual({ kind: 'tasks', keys: ['BTN-1573', 'BTN-1578'] })
  })

  it('names the first commit and how many more when no subject has a task', () => {
    expect(pushLabel('Merge', ['Fix a typo', 'Bump deps', 'Lint'])).toEqual({ kind: 'commit', subject: 'Fix a typo', more: 2 })
    expect(pushLabel('Merge', ['Fix a typo'])).toEqual({ kind: 'commit', subject: 'Fix a typo', more: 0 })
  })

  it('calls a push of merges alone a sync, and keeps the title when the commits are unknown', () => {
    expect(pushLabel("Merge remote-tracking branch 'origin/dev' into dev", [])).toEqual({ kind: 'sync' })
    expect(pushLabel('[BTN-1] Start', undefined)).toEqual({ kind: 'title', title: '[BTN-1] Start' })
  })
})
