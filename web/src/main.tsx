import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import type { BatonState, SessionRecord } from '../../src/state.js'
import { App } from './App.js'
import { LiveConnection, type LiveSource } from './live/connection.js'
import { LiveProvider } from './live/context.js'
import './styles.css'

async function fetchState(): Promise<BatonState> {
  const response = await fetch('/api/state', { cache: 'no-store' })
  if (!response.ok) throw new Error(`/api/state answered ${response.status}`)
  return (await response.json()) as BatonState
}

async function sendCommand(name: string, body: Record<string, unknown>): Promise<BatonState> {
  const response = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer = (await response.json().catch(() => null)) as (BatonState & { error?: string }) | null
  if (!response.ok) throw new Error(answer?.error ?? `/api/${name} answered ${response.status}`)
  return answer!
}

async function fetchSession(sessionId: string): Promise<SessionRecord | null> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
  if (response.status === 404) return null
  const answer = (await response.json().catch(() => null)) as (SessionRecord & { error?: string }) | null
  if (!response.ok) throw new Error(answer?.error ?? `/api/sessions answered ${response.status}`)
  return answer
}

async function createSource(): Promise<LiveSource> {
  if (import.meta.env.MODE === 'fake') return (await import('./live/fake.js')).createFakeSource(location.search)

  const connection = new LiveConnection({
    fetchState,
    openEvents: () => new EventSource('/api/events'),
    sendCommand,
    fetchSession,
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
