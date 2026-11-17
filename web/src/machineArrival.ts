import { useSyncExternalStore } from 'react'

/** The machine a string was issued for and not yet joined with: the window closed, the toast waits for it (BTN-1056). */
export interface PendingMachine {
  machine: string
  expiresAt: number
}

let pending: PendingMachine | null = null
const listeners = new Set<() => void>()

export const machineArrival = {
  get: (): PendingMachine | null => pending,
  set(next: PendingMachine | null): void {
    pending = next
    for (const listener of listeners) listener()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function usePendingMachine(): PendingMachine | null {
  return useSyncExternalStore(machineArrival.subscribe, machineArrival.get)
}
