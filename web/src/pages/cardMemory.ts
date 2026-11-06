import type { TaskCard } from '../../../src/tracker/card.js'

/**
 * The last card read for each task, so a card opened again shows at once and is re-read in the background (BTN-655).
 * Kept in the tab's memory only: tracker data is never written to the browser's disk. Keyed by the project's GUID
 * and the task, since project keys are not unique.
 */
const remembered = new Map<string, TaskCard>()

export const CARD_MEMORY_LIMIT = 200

const keyOf = (project: string, task: string) => `${project}\u0000${task}`

export function recallCard(project: string, task: string): TaskCard | undefined {
  const key = keyOf(project, task)
  const card = remembered.get(key)
  if (card === undefined) return undefined
  remembered.delete(key)
  remembered.set(key, card)
  return card
}

/** `null` is the tracker's "no such task": the card is forgotten, the next open reads it afresh. */
export function rememberCard(project: string, task: string, card: TaskCard | null): void {
  const key = keyOf(project, task)
  remembered.delete(key)
  if (card === null) return
  remembered.set(key, card)
  if (remembered.size > CARD_MEMORY_LIMIT) remembered.delete(remembered.keys().next().value!)
}

export function forgetCards(): void {
  remembered.clear()
}
