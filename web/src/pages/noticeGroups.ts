import { sameNotice, type Notice } from '../../../src/notice/notice.js'
import type { EvenKeelState, ForwardView } from '../../../src/state.js'
import type { ChainStatus } from '../state.js'
import type { BandTone } from '../ui/blocks.js'

export function projectErrors(order: Notice | null, status: ChainStatus): Notice[] {
  const paused = status.kind === 'paused' ? status.error : null
  const errors = paused === null ? [] : [paused]
  if (order !== null && !sameNotice(order, paused)) errors.push(order)
  return errors
}

export function warningTasks(leftovers: EvenKeelState['chain']['leftovers'][string], rows: readonly string[]): string[] {
  return [...new Set(leftovers.filter((each) => !rows.includes(each.task)).map((each) => each.task))]
}

export function forwardTone(forward: ForwardView | undefined): BandTone | null {
  if (forward === undefined || ((forward.behind ?? 0) === 0 && forward.last?.push == null)) return null
  if ((forward.behind ?? 0) > 0 && forward.agent !== undefined) return 'note'
  return (forward.behind ?? 0) > 0 && forward.held ? 'error' : 'warn'
}
