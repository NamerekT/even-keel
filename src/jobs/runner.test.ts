import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseProgress } from '../git/clone-progress.js'
import { fail } from '../notice/notice.js'
import { STAGE_END_MS, StepJobs, type JobPlan, type StepTools } from './runner.js'

function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => (open = resolve))
  return { open, opened }
}

function plan(steps: JobPlan['steps'], extra: Partial<JobPlan> = {}): JobPlan & { undone: number } {
  const made = { undone: 0 }
  return Object.assign(made, {
    kind: 'project',
    subject: 'D:\\projects\\shop',
    steps,
    undo: async () => {
      made.undone += 1
    },
    ...extra,
  })
}

const states = (jobs: StepJobs) => jobs.view()[0]!.steps.map((step) => `${step.id}:${step.state}`)

describe('StepJobs', () => {
  it('runs the steps in order and keeps the finished job with its result until its window closes', async () => {
    const jobs = new StepJobs()
    const ran: string[] = []
    const id = jobs.start(plan([{ id: 'a', run: async () => void ran.push('a') }, { id: 'b', run: async () => void ran.push('b') }], { result: () => 'project-1' }))
    await jobs.settled(id)
    expect(ran).toEqual(['a', 'b'])
    expect(states(jobs)).toEqual(['a:done', 'b:done'])
    expect(jobs.view()).toEqual([expect.objectContaining({ id, done: true, failure: null, result: 'project-1' })])
    jobs.close(id)
    expect(jobs.view()).toEqual([])
  })

  it('stops on a failed step with its notice, and Retry runs it again and goes on, the done ones not repeated', async () => {
    const jobs = new StepJobs()
    let tries = 0
    const ran: string[] = []
    const id = jobs.start(
      plan([
        { id: 'a', run: async () => void ran.push('a') },
        {
          id: 'b',
          run: async () => {
            tries += 1
            if (tries === 1) throw fail('git.remoteNetwork', { remote: 'https://example.com/shop.git' })
            ran.push('b')
          },
        },
      ]),
    )
    await jobs.settled(id)
    expect(states(jobs)).toEqual(['a:done', 'b:failed'])
    expect(jobs.view()[0]!.failure).toEqual(expect.objectContaining({ code: 'git.remoteNetwork' }))
    expect(jobs.view()[0]!.done).toBe(false)
    jobs.retry(id)
    await jobs.settled(id)
    expect(ran).toEqual(['a', 'b'])
    expect(jobs.view()[0]).toEqual(expect.objectContaining({ done: true, failure: null }))
  })

  it('stamps when each step began and ended; Retry begins the failed step anew', async () => {
    let clock = Date.parse('2026-11-13T10:00:00Z')
    const jobs = new StepJobs(() => new Date(clock))
    const at = (seconds: number) => new Date(Date.parse('2026-11-13T10:00:00Z') + seconds * 1000).toISOString()
    const held = gate()
    let tries = 0
    const id = jobs.start(
      plan([
        { id: 'a', run: async () => void (clock += 3000) },
        {
          id: 'b',
          run: async () => {
            tries += 1
            if (tries === 1) {
              clock += 2000
              throw fail('git.remoteNetwork', { remote: 'https://example.com/shop.git' })
            }
            await held.opened
          },
        },
        { id: 'c', run: async () => {} },
      ]),
    )
    await jobs.settled(id)
    expect(jobs.view()[0]!.steps).toEqual([
      { id: 'a', state: 'done', startedAt: at(0), endedAt: at(3) },
      { id: 'b', state: 'failed', startedAt: at(3), endedAt: at(5) },
      { id: 'c', state: 'waiting' },
    ])
    clock += 60_000
    jobs.retry(id)
    expect(jobs.view()[0]!.steps[1]).toEqual({ id: 'b', state: 'running', startedAt: at(65) })
    held.open()
    await jobs.settled(id)
  })

  it('refuses a second live job of a kind, and lets a finished one give way', async () => {
    const jobs = new StepJobs()
    const held = gate()
    const first = jobs.start(plan([{ id: 'a', run: () => held.opened }]))
    expect(() => jobs.start(plan([]))).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'job.busy' }) }))
    held.open()
    await jobs.settled(first)
    const second = jobs.start(plan([]))
    expect(jobs.view().map((job) => job.id)).toEqual([second])
  })

  it('Cancel aborts the running step, takes back what was made and drops the job', async () => {
    const jobs = new StepJobs()
    const started = gate()
    const made = plan([
      {
        id: 'clone',
        run: ({ signal }) =>
          new Promise<void>((_resolve, reject) => {
            started.open()
            signal.addEventListener('abort', () => reject(fail('git.cloneStopped', {})))
          }),
      },
    ])
    const id = jobs.start(made)
    await started.opened
    await jobs.cancel(id)
    expect(made.undone).toBe(1)
    expect(jobs.view()).toEqual([])
  })

  it('keeps what was made once the kept step is done: Cancel then undoes nothing', async () => {
    const jobs = new StepJobs()
    const made = plan([{ id: 'project', run: async () => {} }, { id: 'packages', run: async () => { throw fail('job.packagesUnready', { packages: ['huly'] }) } }], { keptAfter: 'project', result: () => 'project-1' })
    const id = jobs.start(made)
    await jobs.settled(id)
    // The project is there to open while its packages failed.
    expect(jobs.view()[0]).toMatchObject({ undoable: false, done: false, result: 'project-1' })
    await jobs.cancel(id)
    expect(made.undone).toBe(0)
  })

  it('shows a hidden step once another begins it, with the progress it reports', async () => {
    const jobs = new StepJobs()
    const seen: string[][] = []
    jobs.changed = () => seen.push(jobs.view()[0]?.steps.map((step) => `${step.id}:${step.state}${step.progress === undefined ? '' : `:${step.progress.percent}`}`) ?? [])
    const id = jobs.start(
      plan([
        {
          id: 'clone',
          run: async (tools: StepTools) => {
            tools.progress({ stage: 'receiving', percent: 40 })
            tools.begin('lfs')
            tools.progress({ stage: 'lfs', percent: 10 })
          },
        },
        { id: 'lfs', hidden: true },
        { id: 'project', run: async () => {} },
      ]),
    )
    await jobs.settled(id)
    expect(seen).toContainEqual(['clone:running:40', 'project:waiting'])
    expect(seen).toContainEqual(['clone:done', 'lfs:running:10', 'project:waiting'])
    expect(states(jobs)).toEqual(['clone:done', 'lfs:done', 'project:done'])
  })

  it('fails the sub-step that was running and keeps its parent done; Retry runs the sub-step alone, then the rest', async () => {
    const jobs = new StepJobs()
    const calls: string[] = []
    let lfsFails = true
    const id = jobs.start(
      plan([
        {
          id: 'clone',
          run: async (tools: StepTools) => {
            calls.push('clone')
            tools.begin('lfs')
            throw fail('git.lfsMissing', { path: 'a.bin', remote: 'x', command: 'git lfs push --all x' })
          },
        },
        {
          id: 'lfs',
          hidden: true,
          run: async () => {
            calls.push('lfs')
            if (lfsFails) throw fail('git.lfsFailed', { path: 'a.bin' })
          },
        },
        { id: 'project', run: async () => void calls.push('project') },
      ]),
    )
    await jobs.settled(id)
    expect(states(jobs)).toEqual(['clone:done', 'lfs:failed', 'project:waiting'])
    expect(jobs.view()[0]!.failure).toMatchObject({ code: 'git.lfsMissing' })
    jobs.retry(id)
    await jobs.settled(id)
    expect(states(jobs)).toEqual(['clone:done', 'lfs:failed', 'project:waiting'])
    expect(jobs.view()[0]!.failure).toMatchObject({ code: 'git.lfsFailed' })
    lfsFails = false
    jobs.retry(id)
    await jobs.settled(id)
    expect(states(jobs)).toEqual(['clone:done', 'lfs:done', 'project:done'])
    expect(calls).toEqual(['clone', 'lfs', 'lfs', 'project'])
  })

  it('leaves out a hidden step with a run of its own while no step began it', async () => {
    const jobs = new StepJobs()
    const calls: string[] = []
    const id = jobs.start(plan([{ id: 'clone', run: async () => void calls.push('clone') }, { id: 'lfs', hidden: true, run: async () => void calls.push('lfs') }]))
    await jobs.settled(id)
    expect(calls).toEqual(['clone'])
    expect(states(jobs)).toEqual(['clone:done'])
  })

  it('refuses Retry of a job that has not failed and any call on a job that is gone', async () => {
    const jobs = new StepJobs()
    const id = jobs.start(plan([]))
    await jobs.settled(id)
    expect(() => jobs.retry(id)).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'job.notFailed' }) }))
    expect(() => jobs.retry('nope')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'job.unknown' }) }))
  })
})

describe('StepJobs: the end of a stage (BTN-1102)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // `git clone` of a large repository as its stderr came through a pipe: the server compresses its first fifth for five
  // seconds, then the rest, the "done" line and the first "Receiving" line come in one read of a few milliseconds.
  const compressing = (percent: number) => `remote: Compressing objects: ${String(percent).padStart(3)}% (${Math.round(percent * 28.7)}/2870)        `
  const slow = [19, 20, 21].map(compressing)
  const burst = [
    ...Array.from({ length: 79 }, (_, index) => compressing(22 + index)),
    'remote: Compressing objects: 100% (2870/2870), done.        ',
    'Receiving objects:   0% (1/2612378)',
  ]

  /** A clone step that runs until `end` opens, its LFS step and the step after them; the test feeds git's lines. */
  function cloneJob() {
    vi.useFakeTimers()
    const jobs = new StepJobs()
    const end = gate()
    let tools!: StepTools
    const id = jobs.start(
      plan([
        {
          id: 'clone',
          run: async (given) => {
            tools = given
            await end.opened
          },
        },
        { id: 'lfs', hidden: true },
        { id: 'project', run: async () => {} },
      ]),
    )
    const feed = (...lines: string[]) => {
      for (const line of lines) tools.progress(parseProgress(line)!)
    }
    const shown = (step = 'clone') => jobs.view()[0]!.steps.find((each) => each.id === step)?.progress
    return { jobs, id, end, feed, shown, begin: (step: string) => tools.begin(step) }
  }

  it("keeps a stage's last figures on view before the next stage that came in the same burst, then the latest of it", async () => {
    const clone = cloneJob()
    clone.feed(...slow)
    await vi.advanceTimersByTimeAsync(700)
    clone.feed(...burst)
    expect(clone.shown()).toEqual({ stage: 'compressing', percent: 100 })
    await vi.advanceTimersByTimeAsync(200)
    clone.feed('Receiving objects:   0% (23068/2612378), 17.25 MiB | 17.24 MiB/s')
    await vi.advanceTimersByTimeAsync(STAGE_END_MS - 201)
    expect(clone.shown()).toEqual({ stage: 'compressing', percent: 100 })
    await vi.advanceTimersByTimeAsync(1)
    expect(clone.shown()).toMatchObject({ stage: 'receiving', percent: 0, bytes: 18_087_936 })
    clone.end.open()
    await clone.jobs.settled(clone.id)
  })

  it('holds nothing back for a stage that comes long after the last figures', async () => {
    const clone = cloneJob()
    clone.feed("Cloning into 'shop'...")
    await vi.advanceTimersByTimeAsync(9000)
    clone.feed('remote: Enumerating objects: 2612378, done.        ')
    expect(clone.shown()).toEqual({ stage: 'enumerating', objects: 2612378 })
    clone.end.open()
    await clone.jobs.settled(clone.id)
  })

  it('drops the held figures when the step ends: they never land on a finished step', async () => {
    const clone = cloneJob()
    const seen: string[] = []
    clone.jobs.changed = () => seen.push(JSON.stringify(clone.jobs.view()[0]!.steps))
    clone.feed(...burst)
    clone.end.open()
    await clone.jobs.settled(clone.id)
    await vi.advanceTimersByTimeAsync(STAGE_END_MS * 2)
    expect(seen.some((line) => line.includes('receiving'))).toBe(false)
    expect(clone.jobs.view()[0]!.steps.map((step) => step.progress)).toEqual([undefined, undefined])
  })

  it('drops the held figures when another step begins: it starts without them and shows its own at once', async () => {
    const clone = cloneJob()
    clone.feed(...burst)
    clone.begin('lfs')
    await vi.advanceTimersByTimeAsync(STAGE_END_MS * 2)
    expect(clone.shown('clone')).toBeUndefined()
    expect(clone.shown('lfs')).toBeUndefined()
    clone.feed('Filtering content:  50% (1/2), 300.00 KiB | 300.00 KiB/s')
    expect(clone.shown('lfs')).toMatchObject({ stage: 'lfs', percent: 50 })
    clone.end.open()
    await clone.jobs.settled(clone.id)
  })
})
