import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { asNotice, NoticeError } from '../../src/notice/notice.js'
import type { FeedLine } from '../../src/sessions/transcript.js'
import type { EvenKeelState, SessionRecord } from '../../src/state.js'
import type { StatsAnswer } from '../../src/stats/model.js'
import type { ToolsView } from '../../src/tools/model.js'
import type { TaskCard } from '../../src/tracker/card.js'
import { App } from './App.js'
import { LiveConnection, type LiveSource } from './live/connection.js'
import { LiveProvider } from './live/context.js'
import './styles.css'

async function fetchState(): Promise<EvenKeelState> {
  const response = await fetch('/api/state', { cache: 'no-store' })
  if (!response.ok) throw new Error(`/api/state answered ${response.status}`)
  return (await response.json()) as EvenKeelState
}

async function sendCommand(name: string, body: Record<string, unknown>): Promise<EvenKeelState> {
  const response = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer = (await response.json().catch(() => null)) as (EvenKeelState & { error?: string; notice?: unknown }) | null
  if (!response.ok) throw new NoticeError(asNotice(answer?.notice ?? answer?.error ?? `/api/${name} answered ${response.status}`))
  return answer!
}

async function fetchOrNull<T>(path: string): Promise<T | null> {
  const response = await fetch(path, { cache: 'no-store' })
  if (response.status === 404) return null
  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok) throw new Error(answer?.error ?? `${path} answered ${response.status}`)
  return answer
}

const fetchSession = (sessionId: string) => fetchOrNull<SessionRecord>(`/api/sessions/${encodeURIComponent(sessionId)}`)
const fetchTranscript = (sessionId: string) => fetchOrNull<FeedLine[]>(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`)
const fetchTools = (project: string) => fetchOrNull<ToolsView>(`/api/projects/${encodeURIComponent(project)}/tools`)

async function fetchCard(task: string): Promise<TaskCard | null> {
  const path = `/api/tasks/${encodeURIComponent(task)}`
  const response = await fetch(path, { cache: 'no-store' })
  if (response.status === 404) return null
  const answer = (await response.json().catch(() => null)) as (TaskCard & { error?: string; notice?: unknown }) | null
  if (!response.ok) throw new NoticeError(asNotice(answer?.notice ?? answer?.error ?? `${path} answered ${response.status}`))
  return answer
}

async function fetchStats<T>(path: string, search: URLSearchParams): Promise<StatsAnswer<T>> {
  const response = await fetch(`/api/stats/${path}?${search}`, { cache: 'no-store' })
  const answer = (await response.json().catch(() => null)) as (StatsAnswer<T> & { error?: string }) | null
  if (!response.ok) throw new Error(answer?.error ?? `/api/stats answered ${response.status}`)
  return answer!
}

async function createSource(): Promise<LiveSource> {
  if (import.meta.env.MODE === 'fake') return (await import('./live/fake.js')).createFakeSource(location.search)

  const connection = new LiveConnection({
    fetchState,
    openEvents: () => new EventSource('/api/events'),
    sendCommand,
    fetchSession,
    fetchTranscript,
    fetchTools,
    fetchCard,
    fetchStats,
  })
  connection.start()
  window.addEventListener('online', () => connection.retryNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') connection.retryNow()
  })
  return connection
}

const source = await createSource()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveProvider source={source}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LiveProvider>
  </StrictMode>,
)
