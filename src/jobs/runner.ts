import { randomUUID } from 'node:crypto'
import type { CloneProgress } from '../git/clone-progress.js'
import { englishOf, fail, noticeOf, type Notice } from '../notice/notice.js'
import type { JobStep, StepJob, StepState } from './model.js'

export interface StepTools {
  /** Aborted by Cancel: a step that waits or runs a process ends on it. */
  signal: AbortSignal
  progress(progress: CloneProgress | undefined): void
  /** The running step is done and the named one goes on in the same call: the LFS files a clone turned out to have. */
  begin(step: string): void
}

export interface StepDef {
  id: string
  /**
   * Not in the list until another step begins it (`StepTools.begin`). Its `run`, if any, is only its Retry: the steps'
   * run passes it by until it failed (BTN-1106: the LFS files downloaded again into the clone that came).
   */
  hidden?: boolean
  run?(tools: StepTools): Promise<void>
}

export interface JobPlan {
  kind: string
  subject: string
  steps: StepDef[]
  /** Takes back what the steps made; called by Cancel while `undoable` holds. */
  undo(): Promise<void>
  /** Once this step is done, Cancel no longer undoes: the work is kept. */
  keptAfter?: string
  /** What the finished job made. */
  result?(): string | undefined
}

interface Running {
  id: string
  plan: JobPlan
  states: Map<string, JobStep>
  failure: Notice | null
  done: boolean
  kept: boolean
  cancelled: boolean
  /** Steps that failed once: a hidden step runs only then. */
  retried: Set<string>
  abort: AbortController
  run: Promise<void>
}

/** The jobs the page shows as windows of steps: one live job of a kind at a time, kept until its window closes it. */
export class StepJobs {
  private readonly jobs = new Map<string, Running>()
  /** A step moved: the page shows it. */
  changed: (() => void) | undefined

  constructor(private readonly now: () => Date = () => new Date()) {}

  view(): StepJob[] {
    return [...this.jobs.values()].map((job) => {
      // Once kept, what the job made is there to open, even while a later step runs or failed.
      const result = job.done || job.kept ? job.plan.result?.() : undefined
      return {
        id: job.id,
        kind: job.plan.kind,
        subject: job.plan.subject,
        steps: job.plan.steps.flatMap((step) => {
          const state = job.states.get(step.id)!
          return step.hidden === true && state.state === 'waiting' ? [] : [{ ...state }]
        }),
        failure: job.failure,
        done: job.done,
        undoable: !job.kept,
        ...(result === undefined ? {} : { result }),
      }
    })
  }

  /** Starts the plan's steps and returns at once with the job's id; a finished job of the kind gives way to it. */
  start(plan: JobPlan): string {
    for (const job of this.jobs.values()) {
      if (job.plan.kind !== plan.kind) continue
      if (!job.done) throw fail('job.busy', {})
      this.jobs.delete(job.id)
    }
    const job: Running = {
      id: randomUUID(),
      plan,
      states: new Map(plan.steps.map((step) => [step.id, { id: step.id, state: 'waiting' as StepState }])),
      failure: null,
      done: false,
      kept: false,
      cancelled: false,
      retried: new Set(),
      abort: new AbortController(),
      run: Promise.resolve(),
    }
    this.jobs.set(job.id, job)
    job.run = this.run(job)
    return job.id
  }

  /** Runs the failed step again, then the rest. */
  retry(id: string): void {
    const job = this.job(id)
    if (job.failure === null) throw fail('job.notFailed', {})
    job.failure = null
    for (const step of job.states.values()) {
      if (step.state !== 'failed') continue
      step.state = 'waiting'
      job.retried.add(step.id)
    }
    job.abort = new AbortController()
    job.run = this.run(job)
  }

  /** Stops the job and, while nothing of it is kept yet, takes back what it made. */
  async cancel(id: string): Promise<void> {
    const job = this.job(id)
    job.cancelled = true
    job.abort.abort()
    await job.run
    this.jobs.delete(id)
    try {
      if (!job.kept) await job.plan.undo()
    } finally {
      this.changed?.()
    }
    console.log(`jobs: ${job.plan.kind} ${job.plan.subject} is cancelled${job.kept ? '; what it made is kept' : ''}`)
  }

  /** The window of a finished job is closed. */
  close(id: string): void {
    if (this.jobs.get(id)?.done === true) this.jobs.delete(id)
    this.changed?.()
  }

  /** Waits for the job's current run: tests and a shutdown. */
  async settled(id: string): Promise<void> {
    await this.jobs.get(id)?.run
  }

  private job(id: string): Running {
    const job = this.jobs.get(id)
    if (job === undefined) throw fail('job.unknown', {})
    return job
  }

  private async run(job: Running): Promise<void> {
    const { plan } = job
    const mark = (step: string, state: StepState) => {
      const entry = job.states.get(step)!
      entry.state = state
      if (state !== 'running') delete entry.progress
      if (state === 'running') entry.startedAt = this.now().toISOString()
      if (state === 'waiting' || state === 'running') delete entry.endedAt
      else entry.endedAt = this.now().toISOString()
      if (state === 'waiting') delete entry.startedAt
      if (state === 'done' && step === plan.keptAfter) job.kept = true
      this.changed?.()
    }
    for (const step of plan.steps) {
      if (step.run === undefined || job.states.get(step.id)!.state === 'done') continue
      if (step.hidden === true && !job.retried.has(step.id)) continue
      let current = step.id
      mark(current, 'running')
      try {
        await step.run({
          signal: job.abort.signal,
          progress: (progress) => {
            const entry = job.states.get(current)!
            if (progress === undefined) delete entry.progress
            else entry.progress = progress
            this.changed?.()
          },
          begin: (next) => {
            if (current === next) return
            mark(current, 'done')
            current = next
            mark(current, 'running')
          },
        })
      } catch (error) {
        if (job.cancelled) return
        // A sub-step fails on its own, its parent done: Retry runs the sub-step's own `run`, or the parent again without one.
        if (current !== step.id && plan.steps.some((each) => each.id === current && each.run !== undefined)) {
          mark(step.id, 'done')
          mark(current, 'failed')
        } else {
          if (current !== step.id) mark(current, 'waiting')
          mark(step.id, 'failed')
        }
        job.failure = noticeOf(error)
        console.warn(`jobs: ${plan.kind} ${plan.subject}: the step ${step.id} failed: ${englishOf(job.failure)}${job.failure.detail === undefined ? '' : ` (${job.failure.detail})`}`)
        this.changed?.()
        return
      }
      if (job.cancelled) return
      if (current !== step.id) mark(step.id, 'done')
      mark(current, 'done')
    }
    job.done = true
    this.changed?.()
  }
}

/** The service's jobs: the page shows each in a window (`EvenKeelState.jobs`). */
export const stepJobs = new StepJobs()
