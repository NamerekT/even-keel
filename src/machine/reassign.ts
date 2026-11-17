import type { PromptTexts } from '../chain/prompts.js'
import { fill } from '../sessions/prompt.js'
import { notice, type Notice } from '../notice/notice.js'

/** What the hub knows when a person asks to move a task off its machine (BTN-1270, `docs/machines.md`, "A machine gone"). */
export interface ReassignFacts {
  task: string
  /** The machine of the task's `machine_tasks` row; `undefined` — none. */
  holder: string | undefined
  own: string
  /** The holder is connected now and not revoked. */
  connected: boolean
  /** The holder as the page names it. */
  holderName: string
  branch: string
  /** The remote task branches go to; `null` — the repository has none. */
  remote: string | null
  /** The remote has the branch; `{ error }` — the remote did not answer. */
  pushed: boolean | { error: string }
}

/**
 * Why the task cannot move to another machine now; `null` — it can. A task moves only off a machine elsewhere that is
 * gone (away or revoked), and only with its branch on the remote: the new machine has nothing else to start from.
 */
export function reassignable(facts: ReassignFacts): Notice | null {
  const { task, holder } = facts
  if (holder === undefined || holder === facts.own) return notice('reassign.notHeld', { task })
  if (facts.connected) return notice('reassign.machineOnline', { task, machine: facts.holderName })
  if (facts.remote === null) return notice('reassign.noRemote', { task })
  if (typeof facts.pushed === 'object') return notice('reassign.remoteUnknown', { task, error: facts.pushed.error })
  if (!facts.pushed) return notice('reassign.notPushed', { task, branch: facts.branch, machine: facts.holderName })
  return null
}

/**
 * What the first session on the new machine reads after its start prompt: where the task came from, then the last
 * handoff note the hub keeps, when there is one.
 */
export function movedText(text: PromptTexts, machine: string, branch: string, note: string | null): string {
  const lines = ['', text.moved(machine, branch)]
  if (note !== null && note.trim() !== '') lines.push('', text.noteText, '', fill`${note.trim()}`)
  return lines.join('\n') + '\n'
}
