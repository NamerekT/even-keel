import type { TaskMoves } from '../machine/tasks.js'
import { notice, noticeOf, type Notice } from '../notice/notice.js'
import type { Task } from '../tracker/model.js'
import type { MainCarry } from './carry.js'
import { isCarryName, isFixName } from './fix.js'
import { lanesOf } from './lanes.js'
import { moveOffLimit } from './limit-moves.js'
import type { TaskLists } from './lists.js'
import type { MainCheck } from './maincheck.js'
import type { MainFix } from './mainfix.js'
import type { MainWait } from './mainwait.js'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps, ReleaseReason } from './model.js'
import { openBlockers } from './order.js'
import type { LaunchPauses } from './pauses.js'
import type { LanePlacement } from './placement.js'
import { unanswered } from './quiet.js'
import type { Reviews } from './reviews.js'
import { returned as returnedSession, shelve } from './shelved.js'
import { wasSkipped } from './skippedown.js'
import { inTurn, startTask } from './start.js'
import type { Unchanged } from './unchanged.js'

const SLOT_RETRY_MS = 30_000

/** What a part of `Dispatcher.step` needs of the dispatcher: its parts and the moves of a lane. */
export interface StepHost {
  readonly state: ChainState
  readonly deps: DispatcherDeps
  readonly lists: TaskLists
  readonly main: MainCheck | null
  readonly fixes: MainFix | null
  readonly carries: MainCarry
  readonly handovers: TaskMoves
  readonly reviews: Reviews
  readonly unchanged: Unchanged
  readonly waits: MainWait
  readonly pauses: LaunchPauses
  readonly placement: LanePlacement
  halt(chain: ActiveChain, error: Notice, keep?: boolean): void
  release(chain: ActiveChain, reason: ReleaseReason, blockers: string[]): void
  letGo(chain: ActiveChain): void
  take(chain: ActiveChain, current: CurrentTask): void
  drop(chain: ActiveChain): void
  stop(project: string): void
  stopLane(chain: ActiveChain): void
  changed(): void
}

/** `again` — the step starts over; `end` — it is over for this pass; `on` — the lane goes on to its next task. */
export type StepOutcome = 'again' | 'end' | 'on'

/** Asked to stop, the chain only waits out the session's turn: no Done, handoff or relay is followed meanwhile. */
export async function stopAfterTurn(host: StepHost, chain: ActiveChain, tasks: Task[]): Promise<'again' | 'end'> {
  const { state, deps, lists, unchanged } = host
  const current = chain.current
  if (current !== null && inTurn(deps, current)) return 'end'
  // Only the dispatcher closes a task of a project without git, so the mark the turn ended with is still followed (BTN-1044).
  const closes = current !== null && current.sessionId !== null && unchanged.closesByMark(current.task) && tasks.some((open) => open.id === current.task)
  if (closes && (await unchanged.follow(chain, current))) {
    if (chain.paused) return 'end'
    if (lists.done.get(chain.project)?.has(current.task)) {
      chain.current = null
      chain.closing = current.task
      deps.save(state)
      return 'again'
    }
  }
  deps.log(`chain: ${chain.project} stopped after its session's turn, as asked`)
  if (lanesOf(state, chain.project).length > 1) {
    host.stopLane(chain)
    host.changed()
  } else host.stop(chain.project)
  return 'end'
}

/** Follows the lane's current task: a fix of main, a carry or a task of the chain. */
export async function followCurrent(host: StepHost, chain: ActiveChain, current: CurrentTask, tasks: Task[]): Promise<StepOutcome> {
  const { state, deps, lists, fixes, carries, handovers, reviews, unchanged } = host
  const { task, sessionId } = current
  // A skip or a release from the page may end the task while the step awaits (BTN-1330): the step starts over.
  const moved = () => chain.current !== current
  if (sessionId === null) {
    host.halt(chain, notice('chain.interrupted', { task }))
    return 'end'
  }
  if (isFixName(task)) {
    if (fixes === null) chain.current = null
    else if (!(await fixes.follow(chain, current)) && !moved()) {
      // A fix session that found nothing to fix (EKR-88) is over once the red commit turns green, as after a rerun,
      // or main is green past it (BTN-1328); one that ended its turn otherwise is let go once main is green past it.
      const mark = await unchanged.check(chain, current)
      if (moved()) return 'again'
      if (mark === 'acted') return 'end'
      const over = mark === null ? await fixes.outrun(chain, current) : await fixes.unneeded(chain, current)
      if (!over) {
        if (moved()) return 'again'
        await handovers.follow(chain, current)
        return 'end'
      }
    }
    return 'again'
  }
  // A fix session is not let go by unattended mode: that would launch tasks on a red main (BTN-693).
  if (isCarryName(task)) {
    if ((await carries.follow(chain, current)) || moved()) return 'again'
    if (!unanswered(state, deps, current)) {
      await handovers.follow(chain, current)
      return 'end'
    }
    carries.letGo(chain, 'is let go after ten quiet minutes in unattended mode')
    deps.save(state)
    return 'again'
  }
  if (!tasks.some((open) => open.id === task)) {
    if (lists.done.get(chain.project)?.has(task)) {
      chain.current = null
      chain.closing = task
      deps.save(state)
      return 'again'
    }
    shelve(state, deps, chain.project, current)
    host.letGo(chain)
    deps.save(state)
    return 'on'
  }
  const blockers = openBlockers([...tasks, ...(lists.waiting.get(chain.project) ?? [])], task)
  if (blockers.length > 0 && !deps.machine.busy(task)) {
    host.release(chain, 'postpone', blockers)
  } else if ((await reviews.follow(chain, current)) || moved() || (await unchanged.follow(chain, current)) || moved()) {
    // Feedback or a hint went to the session, which leads the chain on; a released or done task left the task list.
    if (chain.current !== null) return 'end'
    return 'again'
  } else if (unanswered(state, deps, current)) {
    const skipped = (state.skipped[chain.project] ??= [])
    if (!skipped.includes(task)) skipped.push(task)
    host.release(chain, 'skip', [])
  } else if (fixes === null || !(await fixes.yields(chain, current))) {
    if (moved()) return 'again'
    await handovers.follow(chain, current)
    return 'end'
  }
  deps.save(state)
  if (chain.paused) return 'end'
  return 'on'
}

/**
 * The lane has no current task: it takes the fix of main, a carry or the next task by the chain's order — a session
 * that lives on or came back, or a launch once nothing holds it.
 */
export async function launchNext(host: StepHost, chain: ActiveChain, tasks: Task[]): Promise<'again' | 'end'> {
  const { state, deps, main, fixes, carries, handovers, reviews, unchanged, waits, pauses, placement } = host
  // Only the project's head lane carries a release project in (BTN-993); the lane `fixer` chose fixes main (BTN-995).
  const head = lanesOf(state, chain.project)[0] === chain
  const fix = fixes?.fixer(chain.project) === chain ? main?.sessionFix(chain.project) : undefined
  // A carry goes after the current task and the one a fix interrupted, before the next by the chain's order (BTN-369).
  const carry = head && fix === undefined && chain.interrupted === undefined ? carries.due(chain.project) : undefined
  const own = fix ?? carry
  if (own === undefined && chain.fixOnly) {
    host.drop(chain)
    deps.save(state)
    return 'end'
  }
  if (fix === undefined && chain.interrupted !== undefined) {
    if (await fixes!.resume(chain, tasks)) return 'again'
    return 'end'
  }

  let next: string | undefined
  const machine = placement.machineOf(chain)
  try {
    next = placement.nextOf(chain.project, tasks, machine, chain)
  } catch (error) {
    host.halt(chain, noticeOf(error))
    return 'end'
  }

  const listed = tasks.map((open) => open.id)
  const task = own?.task ?? next
  if (task === undefined) {
    endLane(host, chain, tasks)
    return 'end'
  }
  // `nextOf` gave no task another machine holds: from here on its facts and launch are the lane's machine's.
  if (machine !== undefined && own === undefined) deps.machines!.bind(chain.project, task, machine)

  const since = deps.now().toISOString()
  const found = deps.machine.liveSession(task)
  // A fix or carry session the user skipped lives on under the name of the next one, which starts a session of its own.
  const live = own !== undefined && found !== undefined && wasSkipped(state, chain.project, task, found) ? undefined : found
  const returned = own === undefined && live !== undefined ? returnedSession(state, deps, chain.project, task, live) : undefined
  if (live !== undefined && returned === undefined) {
    delete chain.limitUntil
    delete chain.modelWeek
    delete chain.slotWait
    delete chain.packagesWait
    delete chain.ciWait
    delete chain.limitsWait
    host.take(chain, { task, sessionId: live, since })
    deps.save(state)
    // The feedback on the task's pull request goes to the session at once.
    if (own === undefined && reviews.feedbackOf(chain.project, task) !== undefined) return 'again'
    return 'end'
  }

  const left = own === undefined && live === undefined ? unchanged.left(chain.project, task) : undefined
  if (left !== undefined) {
    deps.log(`chain: ${task} is not started again: its session ${left} is over and its last turn ended with the mark`)
    host.take(chain, { task, sessionId: left, since })
    deps.save(state)
    return 'again'
  }

  // A handover keeps the task's place and branch: like a relay after a limit, it does not wait for main.
  if (fix === undefined && returned === undefined && waits.heldByMain(chain, task, listed)) return 'end'

  const blocked = pauses.block(chain.project, task)
  if (blocked !== undefined) {
    host.halt(chain, blocked)
    return 'end'
  }

  if (own === undefined && returned === undefined && moveOffLimit(state, deps, chain, task)) return 'again'
  if (pauses.waits(chain, task, fix !== undefined)) return 'end'

  if (returned !== undefined) {
    delete chain.limitUntil
    delete chain.modelWeek
    delete chain.slotWait
    delete chain.ciWait
    const current: CurrentTask = { task, sessionId: returned.session.sessionId, since }
    host.take(chain, current)
    deps.save(state)
    await handovers.handOverCurrent(chain, current, returned.session, returned.reason, returned.extra)
    return 'end'
  }

  const lastTry = chain.slotWait === undefined ? undefined : Date.parse(chain.slotWait.at)
  if (lastTry !== undefined && deps.now().getTime() - lastTry < SLOT_RETRY_MS) return 'end'

  const unjudged = fix === undefined ? main?.due(chain.project) : undefined
  if (unjudged !== undefined) {
    if (!(await waits.checkMain(chain, task, unjudged))) return 'end'
    return 'again'
  }

  delete chain.limitUntil
  delete chain.modelWeek
  const starting: CurrentTask = { task, sessionId: null, since, starting: since }
  host.take(chain, starting)
  deps.save(state)
  const feedback = own === undefined ? (reviews.feedbackOf(chain.project, task) ?? reviews.closedNoteOf(chain.project, task)) : undefined
  await startTask(state, deps, chain, starting, fix, carry, feedback,
    () => reviews.delivered(chain.project, task), (failure) => host.halt(chain, failure))
  return 'end'
}

/**
 * The lane has no task to take. Another lane of the project goes on: only this one ends. The last one ends the chain,
 * unless a task is left that no machine of the lanes may take now — then the project waits in the queue for one.
 */
function endLane(host: StepHost, chain: ActiveChain, tasks: Task[]): void {
  const { state, deps, placement } = host
  const machine = placement.machineOf(chain)
  host.drop(chain)
  if (lanesOf(state, chain.project).length > 0) {
    deps.log(`chain: a lane of ${chain.project} on machine ${machine} ends, no task left for it`)
  } else if (machine !== undefined && placement.nextOf(chain.project, tasks) !== undefined) {
    deps.log(`chain: ${chain.project} waits for a machine that may take its next task`)
    state.queue.unshift(chain.project)
  } else {
    deps.log(`chain: ${chain.project} ended, no task left to run`)
    host.reviews.ended(chain.project)
  }
  deps.save(state)
}
