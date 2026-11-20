import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { liveActions, type LiveActions } from './actions.js'
import { activity } from './activity.js'
import type { LiveSnapshot, LiveSource } from './connection.js'

const LiveContext = createContext<LiveSource | null>(null)

export function LiveProvider({ source, children }: { source: LiveSource; children: ReactNode }) {
  return <LiveContext.Provider value={source}>{children}</LiveContext.Provider>
}

/** The live snapshot and the source's actions, the person's own waits on the top bar (`liveActions`). */
export function useLive(): LiveSnapshot & LiveActions {
  const source = useContext(LiveContext)
  if (source === null) throw new Error('useLive needs a LiveProvider')
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source])
  const snapshot = useSyncExternalStore(subscribe, () => source.snapshot())
  return { ...snapshot, ...liveActions(source, activity) }
}
