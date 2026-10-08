import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { LiveSnapshot, LiveSource } from './connection.js'

const LiveContext = createContext<LiveSource | null>(null)

export function LiveProvider({ source, children }: { source: LiveSource; children: ReactNode }) {
  return <LiveContext.Provider value={source}>{children}</LiveContext.Provider>
}

export function useLive(): LiveSnapshot & Pick<LiveSource, 'retryNow' | 'command' | 'session' | 'tools' | 'card' | 'statsHistory' | 'statsPeriod' | 'statsSteps' | 'statsTask' | 'statsRules' | 'statsRuleDiff' | 'statsCompare'> {
  const source = useContext(LiveContext)
  if (source === null) throw new Error('useLive needs a LiveProvider')
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source])
  const snapshot = useSyncExternalStore(subscribe, () => source.snapshot())
  return {
    ...snapshot,
    retryNow: () => source.retryNow(),
    command: (name, body) => source.command(name, body),
    session: (sessionId) => source.session(sessionId),
    tools: (project) => source.tools(project),
    card: (task) => source.card(task),
    statsHistory: (filter) => source.statsHistory(filter),
    statsPeriod: (query) => source.statsPeriod(query),
    statsSteps: (query) => source.statsSteps(query),
    statsTask: (task) => source.statsTask(task),
    statsRules: (query) => source.statsRules(query),
    statsRuleDiff: (changes) => source.statsRuleDiff(changes),
    statsCompare: (query) => source.statsCompare(query),
  }
}
