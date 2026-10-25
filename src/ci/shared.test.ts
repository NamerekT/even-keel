import { describe, expect, it } from 'vitest'
import type { CiJob, CiRun, CiSource } from './model.js'
import type { CiTarget } from './remote.js'
import { FRESH_MS, SharedSources } from './shared.js'

const TARGET: CiTarget = { kind: 'forgejo', remote: 'origin', web: 'https://forgejo.example.com', owner: 'john', repo: 'app' }
const RUN: CiRun = {
  id: 7,
  number: 7,
  title: 'run 7',
  workflow: 'test.yml',
  commit: 'sha7',
  status: 'running',
  createdAt: '2026-10-12T11:00:00Z',
  startedAt: null,
  stoppedAt: null,
  url: 'https://forgejo.example.com/john/app/actions/runs/7',
}
const JOB: CiJob = { id: 1, name: 'test', status: 'running', startedAt: null, stoppedAt: null, steps: null }

function setup() {
  let clock = 0
  const calls = { made: [] as string[], runs: 0, jobs: 0, log: 0 }
  let failure: Error | null = null
  const sources = new SharedSources(
    (target, token): CiSource | null => {
      if (token === null) return null
      calls.made.push(`${target.remote}:${token}`)
      return {
        runs: async () => {
          calls.runs++
          if (failure !== null) throw failure
          return [RUN]
        },
        jobs: async () => {
          calls.jobs++
          return [JOB]
        },
        log: async () => {
          calls.log++
          return 'tail'
        },
      }
    },
    () => clock,
  )
  return {
    sources,
    calls,
    advance: (ms: number) => (clock += ms),
    fail: (error: Error | null) => (failure = error),
  }
}

describe('SharedSources', () => {
  it('shares runs only for the same branch and limit, keeping unfiltered PR polling separate', async () => {
    const asked: (string | undefined)[] = []
    const sources = new SharedSources(() => ({
      runs: async (_limit, branch) => {
        asked.push(branch)
        return [{ ...RUN, commit: branch ?? 'task-head' }]
      },
      jobs: async () => [],
    }))
    const first = sources.of(TARGET, 'secret')!
    const second = sources.of({ ...TARGET, remote: 'other' }, 'secret')!
    const [dev, release, shared, pr] = await Promise.all([
      first.runs(10, 'dev'), second.runs(10, 'release/v0.1'), second.runs(10, 'dev'), first.runs(10),
    ])
    expect([dev[0]!.commit, release[0]!.commit, shared[0]!.commit, pr[0]!.commit]).toEqual(['dev', 'release/v0.1', 'dev', 'task-head'])
    expect(asked).toEqual(['dev', 'release/v0.1', undefined])
    await second.runs(5, 'dev')
    expect(asked).toHaveLength(4)
  })

  it('gives no source without a token', () => {
    const { sources, calls } = setup()
    expect(sources.of(TARGET, null)).toBeNull()
    expect(calls.made).toEqual([])
  })

  it('asks the API once for the projects of one repository and token, whatever their remotes are named', async () => {
    const { sources, calls } = setup()
    const first = sources.of(TARGET, 'secret')!
    const second = sources.of({ ...TARGET, remote: 'forgejo' }, 'secret')!
    const [a, b] = await Promise.all([first.runs(10), second.runs(10)])
    expect(a).toEqual([RUN])
    expect(b).toEqual([RUN])
    expect(a).not.toBe(b)
    expect(await second.runs(10)).toEqual([RUN])
    expect(calls.runs).toBe(1)
    expect(calls.made).toHaveLength(1)
  })

  it('asks again once the answer is older than FRESH_MS', async () => {
    const { sources, calls, advance } = setup()
    const source = sources.of(TARGET, 'secret')!
    await source.runs(10)
    advance(FRESH_MS - 1)
    await source.runs(10)
    expect(calls.runs).toBe(1)
    advance(1)
    await source.runs(10)
    expect(calls.runs).toBe(2)
  })

  it('polls apart for another token or another repository', async () => {
    const { sources, calls } = setup()
    await sources.of(TARGET, 'secret')!.runs(10)
    await sources.of(TARGET, 'other')!.runs(10)
    await sources.of({ ...TARGET, repo: 'site' }, 'secret')!.runs(10)
    expect(calls.runs).toBe(3)
  })

  it('shares a failure within the window, so the projects do not retry it each', async () => {
    const { sources, calls, fail } = setup()
    fail(new Error('down'))
    const source = sources.of(TARGET, 'secret')!
    await expect(source.runs(10)).rejects.toThrow('down')
    await expect(sources.of(TARGET, 'secret')!.runs(10)).rejects.toThrow('down')
    expect(calls.runs).toBe(1)
  })

  it('shares the jobs of a run in one status, and asks again when the status moves', async () => {
    const { sources, calls } = setup()
    const source = sources.of(TARGET, 'secret')!
    await Promise.all([source.jobs(RUN), sources.of(TARGET, 'secret')!.jobs(RUN)])
    expect(calls.jobs).toBe(1)
    await source.jobs({ ...RUN, status: 'success' })
    expect(calls.jobs).toBe(2)
  })

  it('passes a log through when the CI gives logs, and has none when it does not', async () => {
    const { sources, calls } = setup()
    expect(await sources.of(TARGET, 'secret')!.log!(JOB)).toBe('tail')
    expect(calls.log).toBe(1)
    const bare = new SharedSources(() => ({ runs: async () => [], jobs: async () => [] }))
    expect(bare.of(TARGET, 'secret')!.log).toBeUndefined()
  })

  it('forgets a source nobody asked for within an hour', async () => {
    const { sources, calls, advance } = setup()
    sources.of(TARGET, 'old')
    advance(60 * 60_000)
    sources.of(TARGET, 'secret')
    sources.of(TARGET, 'old')
    expect(calls.made).toEqual(['origin:old', 'origin:secret', 'origin:old'])
  })
})
