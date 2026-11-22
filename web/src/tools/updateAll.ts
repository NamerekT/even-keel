import { useSyncExternalStore } from 'react'
import { noticeOf, type Notice } from '../../../src/notice/notice.js'
import type { PackagesView } from '../../../src/state.js'
import { pendingCommands, type PendingCommand } from './packageView.js'

export interface UpdateStep extends PendingCommand {
  state: 'waiting' | 'running' | 'done' | 'failed'
  notice: Notice | null
}

export interface UpdateAllRun {
  steps: UpdateStep[]
  finished: boolean
}

type Send = (name: PendingCommand['command'], body: { name: string }) => Promise<void>

/**
 * Update all's run, kept outside the catalog (BTN-1480): leaving the settings section unmounts the catalog, the run goes
 * on, and the catalog mounted again shows where it is and what failed. One run at a time; the last one stays until the next.
 */
export class UpdateAllRuns {
  private last: UpdateAllRun | null = null
  private readonly listeners = new Set<() => void>()

  current(): UpdateAllRun | null {
    return this.last
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Presses the rows' commands in turn; a failed one does not stop the rest. */
  async run(pending: PendingCommand[], send: Send): Promise<void> {
    if (this.last?.finished === false || pending.length === 0) return
    let steps: UpdateStep[] = pending.map((each, index) => ({ ...each, state: index === 0 ? 'running' : 'waiting', notice: null }))
    this.set({ steps, finished: false })
    for (const [index, each] of pending.entries()) {
      let ended: Pick<UpdateStep, 'state' | 'notice'>
      try {
        await send(each.command, { name: each.name })
        ended = { state: 'done', notice: null }
      } catch (reason) {
        ended = { state: 'failed', notice: noticeOf(reason) }
      }
      steps = steps.map((step, at) => (at === index ? { ...step, ...ended } : at === index + 1 ? { ...step, state: 'running' } : step))
      this.set({ steps, finished: index === pending.length - 1 })
    }
  }

  private set(run: UpdateAllRun): void {
    this.last = run
    for (const listener of this.listeners) listener()
  }
}

export const updateAllRuns = new UpdateAllRuns()

const subscribe = (listener: () => void) => updateAllRuns.subscribe(listener)
const snapshot = () => updateAllRuns.current()

export function useUpdateAll(): UpdateAllRun | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * The failures of a finished run that the catalog shows by Update all: of a row that still waits for its command and
 * has no error of its own to show it (a command refused before the service logged it, a page that lost the service).
 */
export function unshownFailures(run: UpdateAllRun | null, view: PackagesView): { name: string; notice: Notice }[] {
  if (run?.finished !== true) return []
  const waiting = new Set(pendingCommands(view).map((each) => each.name))
  return run.steps.flatMap((step) => {
    const row = view.packages.find((pkg) => pkg.name === step.name)
    return step.state === 'failed' && step.notice !== null && row !== undefined && row.error === null && waiting.has(step.name) ? [{ name: step.name, notice: step.notice }] : []
  })
}

/** The row Update all is on now, `null` — none. */
export function runningStep(run: UpdateAllRun | null): UpdateStep | null {
  return run?.steps.find((step) => step.state === 'running') ?? null
}
