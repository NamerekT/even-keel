import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { LiveSnapshot, LiveSource } from './connection.js'

const LiveContext = createContext<LiveSource | null>(null)

export function LiveProvider({ source, children }: { source: LiveSource; children: ReactNode }) {
  return <LiveContext.Provider value={source}>{children}</LiveContext.Provider>
}

export function useLive(): LiveSnapshot & Pick<LiveSource, 'retryNow' | 'command' | 'session' | 'stats'> {
  const source = useContext(LiveContext)
  if (source === null) throw new Error('useLive needs a LiveProvider')
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source])
  const snapshot = useSyncExternalStore(subscribe, () => source.snapshot())
  return {
    ...snapshot,
    retryNow: () => source.retryNow(),
    command: (name, body) => source.command(name, body),
    session: (sessionId) => source.session(sessionId),
    stats: (project, query) => source.stats(project, query),
  }
}
