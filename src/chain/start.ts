import { englishOf, notice, noticeOf, sameNotice, type Notice } from '../notice/notice.js'
import type { ActiveChain, CarrySession, ChainState, CurrentTask, DispatcherDeps, SessionFix } from './model.js'

const SLOT_REFUSALS = new Set(['slot.noneFree', 'slot.busyStart'])

/** Starts the prepared task and records its session, or leaves an unattended chain waiting for a slot. */
export async function startTask(
  state: ChainState,
  deps: DispatcherDeps,
  chain: ActiveChain,
  current: CurrentTask,
  fix: SessionFix | undefined,
  carry: CarrySession | undefined,
  feedback: string | undefined,
  delivered: () => void,
  halt: (failure: Notice) => void,
): Promise<void> {
  const { task, since } = current
  const own = fix ?? carry
  try {
    const { sessionId, fallback } =
      fix !== undefined
        ? { sessionId: await deps.launchFix(chain.project, task, fix.report) }
        : carry !== undefined
          ? { sessionId: await deps.launchCarry(chain.project, task, carry.report) }
          : feedback !== undefined
            ? await deps.launch(chain.project, task, feedback)
            : await deps.launch(chain.project, task)
    if (feedback !== undefined) delivered()
    deps.journal({
      at: since,
      project: chain.project,
      task,
      sessionId,
      ...(own !== undefined && { commit: own.commit }),
      ...(feedback !== undefined && { reason: 'review' as const }),
      ...(fallback !== undefined && { fallback }),
    })
    current.sessionId = sessionId
    delete current.starting
    delete chain.slotWait
    deps.save(state)
  } catch (error) {
    const failure = noticeOf(error)
    if (state.unattended && SLOT_REFUSALS.has(failure.code)) waitForSlot(state, deps, chain, task, failure)
    else halt(failure)
  }
}

/** The task never started, so it is not released: the chain picks it again once a slot frees up. */
function waitForSlot(state: ChainState, deps: DispatcherDeps, chain: ActiveChain, task: string, refusal: Notice): void {
  chain.current = null
  const waiting = notice('slot.waiting', { task }, { items: refusal.items ?? [refusal] })
  if (!sameNotice(chain.slotWait?.notice ?? null, waiting)) deps.log(`chain: ${chain.project}: ${englishOf(waiting)}`)
  chain.slotWait = { notice: waiting, at: deps.now().toISOString() }
  deps.save(state)
}
