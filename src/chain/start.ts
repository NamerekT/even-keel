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
    // A fix or a carry session runs no tracker task. A refused move is the page's to show, never the chain's halt.
    if (own === undefined) void deps.moveStatus?.(chain.project, task, 'start').catch((error) => deps.log(`chain: ${task} was not moved on its start: ${String(error)}`))
  } catch (error) {
    const failure = noticeOf(error)
    // The CLI check holds the account folder for minutes and lets it go by itself (BTN-569): a wait in any mode.
    if (failure.code === 'cliCheck.busy') waitForSlot(state, deps, chain, notice('cliCheck.chainWaits', { task, account: failure.params.account }))
    else if (state.unattended && SLOT_REFUSALS.has(failure.code)) waitForSlot(state, deps, chain, notice('slot.waiting', { task }, { items: failure.items ?? [failure] }))
    else halt(failure)
  }
}

/** The task never started, so it is not released: the chain picks it again once a slot frees up. */
function waitForSlot(state: ChainState, deps: DispatcherDeps, chain: ActiveChain, waiting: Notice): void {
  chain.current = null
  if (!sameNotice(chain.slotWait?.notice ?? null, waiting)) deps.log(`chain: ${chain.project}: ${englishOf(waiting)}`)
  chain.slotWait = { notice: waiting, at: deps.now().toISOString() }
  deps.save(state)
}
