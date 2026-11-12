import { describe, expect, it } from 'vitest'
import { fail } from '../notice/notice.js'
import { StepJobs, type JobPlan, type StepTools } from './runner.js'

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
    expect(jobs.view()).toEqual([expect.objectContaining({ id, done: true, failure: null, result: 'project-1', steps: [{ id: 'a', state: 'done' }, { id: 'b', state: 'done' }] })])
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
    const made = plan([{ id: 'project', run: async () => {} }, { id: 'packages', run: async () => { throw fail('job.packagesUnready', { packages: ['huly'] }) } }], { keptAfter: 'project' })
    const id = jobs.start(made)
    await jobs.settled(id)
    expect(jobs.view()[0]!.undoable).toBe(false)
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

  it('refuses Retry of a job that has not failed and any call on a job that is gone', async () => {
    const jobs = new StepJobs()
    const id = jobs.start(plan([]))
    await jobs.settled(id)
    expect(() => jobs.retry(id)).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'job.notFailed' }) }))
    expect(() => jobs.retry('nope')).toThrow(expect.objectContaining({ notice: expect.objectContaining({ code: 'job.unknown' }) }))
  })
})
