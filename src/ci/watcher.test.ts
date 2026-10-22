import { describe, expect, it } from 'vitest'
import type { Git } from '../git/types.js'
import { fail } from '../notice/notice.js'
import type { CiJob, CiRun, CiSource } from './model.js'
import { CiWatch, ERROR_RETRY_MS, POLL_MS, PUSH_WINDOW_MS } from './watcher.js'

const TARGET = { kind: 'forgejo' as const, remote: 'origin', web: 'https://forgejo.example.com', owner: 'john', repo: 'app' }
const GITHUB = { kind: 'github' as const, remote: 'github', web: 'https://github.com', owner: 'john', repo: 'app' }

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

function setup(options: { runs?: CiRun[]; source?: false; jobs?: CiJob[]; log?: CiSource['log']; main?: string; target?: typeof TARGET | typeof GITHUB } = {}) {
  let clock = Date.parse('2026-10-12T12:00:00Z')
  let head = 'sha2'
  const refs: string[] = []
  let runs = options.runs ?? [run(2), run(1)]
  let failure: Error | null = null
  const calls = { runs: 0, jobs: [] as number[] }
  const logs: string[] = []
  let changes = 0
  const jobs: CiJob[] = options.jobs ?? [{ id: 1, name: 'test', status: 'success', startedAt: null, stoppedAt: null, steps: null }]
  const source: CiSource = {
    ...(options.log === undefined ? {} : { log: options.log }),
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
    if (args[0] === 'rev-parse') {
      refs.push(args.at(-1)!)
      return { code: 0, out: head }
    }
    if (args[0] === 'log') return { code: 0, out: args.includes('sha1..sha2') ? '[ABC-2] Second\n[ABC-1] Merged in' : '[ABC-9] Other' }
    return { code: 1, out: '' }
  }
  const watch = new CiWatch({
    target: options.target ?? TARGET,
    source: options.source === false ? null : source,
    git,
    repo: 'D:/repos/app',
    ...(options.main === undefined ? {} : { main: () => options.main! }),
    now: () => new Date(clock),
    log: (message) => logs.push(message),
    onChange: () => changes++,
  })
  return {
    watch,
    calls,
    refs,
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

  it('watches the remote’s copy of the project’s main branch, main by default', async () => {
    const plain = setup()
    await plain.watch.tick()
    expect(plain.refs).toEqual(['refs/remotes/origin/main'])
    const named = setup({ main: 'master' })
    await named.watch.tick()
    expect(named.refs).toEqual(['refs/remotes/origin/master'])
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
    expect(t.watch.view).toMatchObject({ health: 'off', error: { code: 'ci.noToken', params: { kind: 'forgejo' } } })
  })

  it('asks at once when a token appears, and goes off again when it is removed', async () => {
    const t = setup({ source: false })
    await t.watch.tick()
    const source: CiSource = { runs: async () => [run(3)], jobs: async () => [] }
    t.watch.setSource(source)
    expect(t.watch.view).toMatchObject({ health: 'ok', error: null })
    await t.watch.tick()
    expect(t.watch.view.history.map((each) => each.id)).toEqual([3])
    t.watch.setSource(null)
    expect(t.watch.view).toMatchObject({ health: 'off', error: { code: 'ci.noToken' } })
    expect(t.changes()).toBeGreaterThan(0)
  })
})

describe('CiWatch.failed', () => {
  const red = run(2, { status: 'failure' })
  const failedJobs: CiJob[] = [
    { id: 1, name: 'lint', status: 'success', startedAt: null, stoppedAt: null, steps: [] },
    { id: 5, name: 'test', status: 'failure', startedAt: null, stoppedAt: null, steps: [] },
  ]

  it('reuses the jobs of the current run and reads the tail of the first failed job', async () => {
    const asked: number[] = []
    const t = setup({ runs: [red, run(1)], jobs: failedJobs, log: async (job) => (asked.push(job.id), '2026-10-12T11:00:00.1Z a\n2026-10-12T11:00:01.1Z FAIL\n') })
    await t.watch.tick()
    expect(await t.watch.failed(red)).toEqual({ kind: 'forgejo', run: red, jobs: failedJobs, log: 'a\nFAIL' })
    expect(t.calls.jobs).toEqual([2])
    expect(asked).toEqual([5])
  })

  it('asks for the jobs of an older run and leaves the log out when the CI gives none', async () => {
    const t = setup({ runs: [run(3), red], jobs: failedJobs })
    await t.watch.tick()
    expect(await t.watch.failed(red)).toEqual({ kind: 'forgejo', run: red, jobs: failedJobs, log: null })
    expect(t.calls.jobs).toEqual([3, 2])
  })

  it('keeps what it read when the log fails', async () => {
    const t = setup({ runs: [red], jobs: failedJobs, log: async () => { throw fail('ci.http', { ci: 'GitHub Actions', status: 410 }) } })
    expect(await t.watch.failed(red)).toEqual({ kind: 'forgejo', run: red, jobs: failedJobs, log: null })
    expect(t.logs).toHaveLength(1)
  })

  it('hides GitHub Actions without a token and while the token does not reach them, and shows them once it does', async () => {
    expect(setup({ target: GITHUB, source: false }).watch.hidden).toBe(true)
    const t = setup({ target: GITHUB })
    expect(t.watch.hidden).toBe(false)
    t.fail(fail('ci.http', { ci: 'GitHub Actions', status: 404 }))
    await t.watch.tick()
    expect(t.watch.hidden).toBe(true)
    t.fail(null)
    t.advance(ERROR_RETRY_MS)
    await t.watch.tick()
    expect(t.watch.hidden).toBe(false)
    t.fail(fail('ci.denied', { ci: 'GitHub Actions', status: 403 }))
    t.watch.setSource(null)
    expect(t.watch.hidden).toBe(true)
  })

  it('hides a Forgejo watch by the same rule: no profile on its host, a refused token or a repository it does not see', async () => {
    expect(setup({ source: false }).watch.hidden).toBe(true)
    const t = setup()
    t.fail(fail('ci.denied', { ci: 'Forgejo', status: 401 }))
    await t.watch.tick()
    expect(t.watch.hidden).toBe(true)
    const unseen = setup()
    unseen.fail(fail('ci.http', { ci: 'Forgejo', status: 404 }))
    await unseen.watch.tick()
    expect(unseen.watch.hidden).toBe(true)
    const down = setup()
    down.fail(fail('ci.http', { ci: 'Forgejo', status: 502 }))
    await down.watch.tick()
    expect(down.watch).toMatchObject({ hidden: false, view: { health: 'error' } })
  })
})
