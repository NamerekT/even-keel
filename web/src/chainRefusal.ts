import { useSyncExternalStore } from 'react'
import type { Notice } from '../../src/notice/notice.js'

/** A drop in the chain the server refused (BTN-1644): the dragged task and the refusal, for a toast in sight. */
export interface ChainRefusal {
  task: string
  notice: Notice
}

let refusal: ChainRefusal | null = null
const listeners = new Set<() => void>()

export const chainRefusal = {
  get: (): ChainRefusal | null => refusal,
  set(next: ChainRefusal | null): void {
    if (next === refusal) return
    refusal = next
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useChainRefusal(): ChainRefusal | null {
  return useSyncExternalStore(chainRefusal.subscribe, chainRefusal.get)
}
