import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { activity } from './activity.js'
import type { LiveSnapshot, LiveSource } from './connection.js'

const LiveContext = createContext<LiveSource | null>(null)

export function LiveProvider({ source, children }: { source: LiveSource; children: ReactNode }) {
  return <LiveContext.Provider value={source}>{children}</LiveContext.Provider>
}

export function useLive(): LiveSnapshot & Pick<LiveSource, 'retryNow' | 'command' | 'session' | 'transcript' | 'onTranscript' | 'imageUrl' | 'sentFileUrl' | 'tools' | 'card' | 'checkProject' | 'statsHistory' | 'statsPeriod' | 'statsSteps' | 'statsCheckpoints' | 'statsSpend' | 'statsTask' | 'statsRules' | 'statsRuleDiff' | 'statsCompare'> {
  const source = useContext(LiveContext)
  if (source === null) throw new Error('useLive needs a LiveProvider')
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source])
  const snapshot = useSyncExternalStore(subscribe, () => source.snapshot())
  return {
    ...snapshot,
    retryNow: () => source.retryNow(),
    command: (name, body) => activity.track(source.command(name, body)),
    session: (sessionId) => activity.track(source.session(sessionId)),
    transcript: (sessionId, after) => source.transcript(sessionId, after),
    onTranscript: (sessionId, listener) => source.onTranscript(sessionId, listener),
    imageUrl: (sessionId, tool, index) => source.imageUrl(sessionId, tool, index),
    sentFileUrl: (sessionId, name) => source.sentFileUrl(sessionId, name),
    tools: (project) => activity.track(source.tools(project)),
    card: (task) => activity.track(source.card(task)),
    checkProject: (draft) => activity.track(source.checkProject(draft)),
    statsHistory: (filter) => source.statsHistory(filter),
    statsPeriod: (query) => source.statsPeriod(query),
    statsSteps: (query) => source.statsSteps(query),
    statsCheckpoints: () => source.statsCheckpoints(),
    statsSpend: (tz) => source.statsSpend(tz),
    statsTask: (task) => source.statsTask(task),
    statsRules: (query) => source.statsRules(query),
    statsRuleDiff: (changes) => source.statsRuleDiff(changes),
    statsCompare: (query) => source.statsCompare(query),
  }
}
