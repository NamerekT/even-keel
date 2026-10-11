import { describe, expect, it } from 'vitest'
import type { Git } from '../git/types.js'
import { fail } from '../notice/notice.js'
import type { CiJob, CiRun, CiSource } from './model.js'
import { CiWatch, ERROR_RETRY_MS, POLL_MS, PUSH_WINDOW_MS } from './watcher.js'

const TARGET = { kind: 'forgejo' as const, remote: 'origin', web: 'https://forgejo.example.com', owner: 'john', repo: 'app' }

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
    url: `https://forgejo.example.com/john/app/actions/runs/${id}`,
    ...overrides,
  }
}

function setup(options: { runs?: CiRun[]; source?: false } = {}) {
  let clock = Date.parse('2026-10-12T12:00:00Z')
  let head = 'sha2'
  let runs = options.runs ?? [run(2), run(1)]
  let failure: Error | null = null
  const calls = { runs: 0, jobs: [] as number[] }
  const logs: string[] = []
  let changes = 0
  const jobs: CiJob[] = [{ id: 1, name: 'test', status: 'success', startedAt: null, stoppedAt: null, steps: null }]
  const source: CiSource = {
    runs: async () => {
      calls.runs++
      if (failure !== null) throw failure
      return runs
    },
    jobs: async (each) => {
      calls.jobs.push(each.id)
      return jobs
    },
  }
  const git: Git = async (_cwd, args) => {
    if (args[0] === 'rev-parse') return { code: 0, out: head }
    if (args[0] === 'log') return { code: 0, out: args.includes('sha1..sha2') ? '[ABC-2] Second\n[ABC-1] Merged in' : '[ABC-9] Other' }
    return { code: 1, out: '' }
  }
  const watch = new CiWatch({
    target: TARGET,
    source: options.source === false ? null : source,
    variable: 'FORGEJO_TOKEN',
    git,
    repo: 'D:/repos/app',
    now: () => new Date(clock),
    log: (message) => logs.push(message),
    onChange: () => changes++,
  })
  return {
    watch,
    calls,
    logs,
    changes: () => changes,
    advance: (ms: number) => (clock += ms),
    push: (sha: string) => (head = sha),
    setRuns: (next: CiRun[]) => (runs = next),
    fail: (error: Error | null) => (failure = error),
  }
}

describe('CiWatch', () => {
  it('reads the history once at the start and stays quiet after', async () => {
    const t = setup()
    await t.watch.tick()
    expect(t.watch.view).toMatchObject({ kind: 'forgejo', remote: 'origin', url: 'https://forgejo.example.com/john/app/actions', health: 'ok', medianMs: 180_000, pushed: null })
    expect(t.watch.view.current).toMatchObject({ run: { id: 2 }, tasks: ['ABC-2', 'ABC-1'] })
    expect(t.watch.view.history.map((each) => each.id)).toEqual([2, 1])
    expect(t.calls).toEqual({ runs: 1, jobs: [2] })
    expect(t.changes()).toBe(1)

    t.advance(POLL_MS * 10)
    await t.watch.tick()
    expect(t.calls.runs).toBe(1)
  })

  it('polls while a run is unfinished, at most every POLL_MS', async () => {
    const t = setup({ runs: [run(3, { status: 'running', stoppedAt: null }), run(2)] })
    await t.watch.tick()
    t.advance(POLL_MS - 1)
    await t.watch.tick()
    expect(t.calls.runs).toBe(1)
    t.advance(1)
    t.setRuns([run(3), run(2)])
    await t.watch.tick()
    expect(t.calls).toEqual({ runs: 2, jobs: [3, 3] })
    expect(t.watch.view.current?.run.status).toBe('success')
    t.advance(POLL_MS)
    await t.watch.tick()
    expect(t.calls.runs).toBe(2)
  })

  it('notices a push, polls until a run takes it, then stops', async () => {
    const t = setup()
    await t.watch.tick()
    t.advance(1_000)
    t.push('sha3')
    await t.watch.tick()
    expect(t.calls.runs).toBe(2)
    expect(t.watch.view.pushed).toEqual({ commit: 'sha3', at: '2026-10-12T12:00:01.000Z' })

    t.advance(POLL_MS)
    t.setRuns([run(3, { status: 'queued', createdAt: '2026-10-12T12:00:05Z', startedAt: null, stoppedAt: null }), run(2), run(1)])
    await t.watch.tick()
    expect(t.watch.view.pushed).toBeNull()
    expect(t.watch.view.current?.run.id).toBe(3)
  })

  it('gives up polling a push no run takes after the push window', async () => {
    const t = setup()
    await t.watch.tick()
    t.push('sha3')
    await t.watch.tick()
    t.advance(PUSH_WINDOW_MS)
    await t.watch.tick()
    const polled = t.calls.runs
    t.advance(POLL_MS)
    await t.watch.tick()
    expect(t.calls.runs).toBe(polled)
    expect(t.watch.view.pushed?.commit).toBe('sha3')
  })

  it('shows an error and retries it slowly', async () => {
    const t = setup()
    t.fail(fail('ci.unreachable', { ci: 'Forgejo' }))
    await t.watch.tick()
    expect(t.watch.view.health).toBe('error')
    expect(t.watch.view.error).toMatchObject({ code: 'ci.unreachable' })
    expect(t.logs).toEqual(['ci: origin of D:/repos/app: Forgejo: the API did not answer'])

    t.advance(ERROR_RETRY_MS - 1)
    await t.watch.tick()
    expect(t.calls.runs).toBe(1)
    t.fail(null)
    t.advance(1)
    await t.watch.tick()
    expect(t.watch.view).toMatchObject({ health: 'ok', error: null })
  })

  it('is off without a token and never asks', async () => {
    const t = setup({ source: false })
    await t.watch.tick()
    expect(t.watch.view).toMatchObject({ health: 'off', error: { code: 'ci.noToken', params: { variable: 'FORGEJO_TOKEN' } } })
  })
})
