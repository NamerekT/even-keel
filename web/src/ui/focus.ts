import { hasSession } from '../state.js'

interface Item {
  id: string
  open: boolean
}

type Entry = Parameters<typeof hasSession>[0] & { id: string; current: boolean }

/** The task whose session opens on arriving at a project page: the chain's current one, unless the address names something. */
export function focusOnEntry(blocks: Entry[], focus: string): string | null {
  if (focus !== '') return null
  return blocks.find((block) => block.current && hasSession(block))?.id ?? null
}

export function focusAfterClose(before: Item[], after: Item[], focus: string): string | null {
  if (before.find((block) => block.id === focus)?.open !== true) return null
  const index = after.findIndex((block) => block.id === focus)
  if (index < 0 || after[index]!.open) return null
  return after.slice(index + 1).find((block) => block.open)?.id ?? null
}
