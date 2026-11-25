import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { isLanguage } from '../../src/language.js'
import { asNotice, NoticeError } from '../../src/notice/notice.js'
import type { Feed } from '../../src/sessions/transcript.js'
import type { ProjectCheck, ProjectDraft, SessionRecord } from '../../src/state.js'
import type { SessionCheckpoint } from '../../src/stats/checkpoint.js'
import type { StatsAnswer } from '../../src/stats/model.js'
import type { ToolsView } from '../../src/tools/model.js'
import type { TaskCard } from '../../src/tracker/card.js'
import type { TrackerVocabulary } from '../../src/tracker/source.js'
import type { AuthState } from '../../src/access/view.js'
import { App } from './App.js'
import { pickLanguage, setLanguage } from './i18n/index.js'
import { LiveConnection, type AttachedFile, type LiveSource, type QueryOptions } from './live/connection.js'
import { LiveProvider } from './live/context.js'
import { fitsKeepalive } from './pages/cardDrafts.js'
import type { AuthPost } from './pages/passkey.js'
import { InviteJoin } from './pages/InviteJoin.js'
import { cameraHere } from './pages/qrScan.js'
import { SignIn } from './pages/SignIn.js'
import { pageIdle, reloadOnMissingChunk, watchBuild } from './live/reload.js'
import { watchTheme } from './theme.js'
import './styles.css'

/**
 * The sign-in went from under the page (`docs/web/sign-in.md`, "Revoking"): a refused request — the token changed on a
 * hub without sign-ins — or the hub saying this browser is not in, its device revoked.
 */
async function signedOut(): Promise<boolean> {
  const response = await fetch('/api/auth/state', { cache: 'no-store' })
  if (response.status === 401) return true
  if (!response.ok) return false
  return !((await response.json()) as AuthState).signedIn
}

async function sendCommand(name: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const answer = (await response.json().catch(() => null)) as { error?: string; notice?: unknown } | null
  if (!response.ok) throw new NoticeError(asNotice(answer?.notice ?? answer?.error ?? `/api/${name} answered ${response.status}`))
}

async function fetchOrNull<T>(path: string): Promise<T | null> {
  const response = await fetch(path, { cache: 'no-store' })
  if (response.status === 404) return null
  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok) throw new Error(answer?.error ?? `${path} answered ${response.status}`)
  return answer
}

const fetchSession = (sessionId: string) => fetchOrNull<SessionRecord>(`/api/sessions/${encodeURIComponent(sessionId)}`)
const fetchTranscript = (sessionId: string, after: number) =>
  fetchOrNull<Feed>(`/api/sessions/${encodeURIComponent(sessionId)}/transcript?after=${after}`)
const fetchCheckpoint = (sessionId: string) => fetchOrNull<SessionCheckpoint>(`/api/sessions/${encodeURIComponent(sessionId)}/checkpoint`)
const fetchTools = (project: string) => fetchOrNull<ToolsView>(`/api/projects/${encodeURIComponent(project)}/tools`)
const fetchVocabulary = (projectId: string) => fetchOrNull<TrackerVocabulary>(`/api/projects/${encodeURIComponent(projectId)}/vocabulary`)

async function fetchCard(task: string): Promise<TaskCard | null> {
  const path = `/api/tasks/${encodeURIComponent(task)}`
  const response = await fetch(path, { cache: 'no-store' })
  if (response.status === 404) return null
  const answer = (await response.json().catch(() => null)) as (TaskCard & { error?: string; notice?: unknown }) | null
  if (!response.ok) throw new NoticeError(asNotice(answer?.notice ?? answer?.error ?? `${path} answered ${response.status}`))
  return answer
}

async function sendQuery(name: string, body: object, options?: QueryOptions): Promise<unknown> {
  const json = JSON.stringify(body)
  const response = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: json,
    // A bigger body goes the usual way: the card's local draft covers it if the tab is gone first.
    keepalive: options?.keepalive === true && fitsKeepalive(json),
  })
  const answer = (await response.json().catch(() => null)) as { error?: string; notice?: unknown } | null
  if (!response.ok) throw new NoticeError(asNotice(answer?.notice ?? answer?.error ?? `/api/${name} answered ${response.status}`))
  return answer
}

const checkProject = (draft: ProjectDraft, askTracker: boolean) => sendQuery('project/check', { ...draft, askTracker }) as Promise<ProjectCheck>

/** The bytes go as the body itself: no form encoding, the service writes them to disk as they come. */
async function sendFile(task: string, file: File): Promise<AttachedFile> {
  const path = `/api/builtin/attach?${new URLSearchParams({ task, name: file.name })}`
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file })
  const answer = (await response.json().catch(() => null)) as (AttachedFile & { error?: string; notice?: unknown }) | null
  if (!response.ok) throw new NoticeError(asNotice(answer?.notice ?? answer?.error ?? `${path} answered ${response.status}`))
  return answer!
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
    signedOut,
    // Loaded anew, the page gets the sign-in screen or the form that asks for the new token.
    showSignIn: () => location.reload(),
    openEvents: () => new EventSource('/api/events'),
    sendCommand,
    fetchSession,
    fetchTranscript,
    fetchCheckpoint,
    fetchTools,
    fetchCard,
    fetchVocabulary,
    checkProject,
    sendQuery,
    sendFile,
    fetchStats,
  })
  const buildSeen = watchBuild({
    loaded: document.documentElement.outerHTML,
    fetchIndex: async () => {
      const response = await fetch('/', { cache: 'no-store' })
      if (!response.ok) throw new Error(`/ answered ${response.status}`)
      return response.text()
    },
    idle: () => pageIdle(document),
    reload: () => location.reload(),
    later: (check) => setTimeout(check, 2_000),
  })
  connection.subscribe(() => {
    const state = connection.snapshot().state
    if (state !== null) buildSeen(state.startedAt)
  })
  window.addEventListener('vite:preloadError', () => reloadOnMissingChunk(sessionStorage, Date.now(), () => location.reload()))
  connection.start()
  window.addEventListener('online', () => connection.retryNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') connection.wake()
  })
  return connection
}

/** The sign-in screen instead of the page while this browser is not in (`docs/web/sign-in.md`); `false` — go on to the page. */
async function signInShown(): Promise<boolean> {
  const fake = import.meta.env.MODE === 'fake'
  if (location.pathname === INVITE_PATH) {
    const join = fake ? await fakeJoin() : await realJoin()
    if (join === null) return false
    render(fake, <InviteJoin {...join} />)
    return true
  }
  const asked = fake ? await fakeSignIn() : await realSignIn()
  if (asked === null) return false
  render(fake, <SignIn {...asked} />)
  return true
}

function render(fake: boolean, screen: ReactNode): void {
  // The configured language is behind the sign-in: the browser's, or `dev:fake`'s `?lang=`.
  const wanted = fake ? new URLSearchParams(location.search).get('lang') : null
  setLanguage(pickLanguage(wanted !== null && isLanguage(wanted) ? wanted : null, navigator.languages))
  createRoot(document.getElementById('root')!).render(<StrictMode>{screen}</StrictMode>)
}

type SignInProps = Parameters<typeof SignIn>[0]
type JoinProps = Parameters<typeof InviteJoin>[0]

/** The new device's door of an invitation (BTN-1655): `/invite#<secret>`, the secret never sent with the page's load. */
const INVITE_PATH = '/invite'

async function realJoin(): Promise<JoinProps | null> {
  const response = await fetch('/api/auth/state', { cache: 'no-store' }).catch(() => null)
  if (response === null || !response.ok) return null
  const state = (await response.json()) as AuthState
  const post: AuthPost = async <T,>(name: string, body: object) => (await sendQuery(name, body)) as T
  return { signedIn: !state.takesInvite, link: location.hash.slice(1), post, entered: () => location.replace('/') }
}

/** `dev:fake`'s `/invite`: signed in already, or with `?signIn` a new device (`?invite=` picks the outcome, `fakeAuth.ts`). */
async function fakeJoin(): Promise<JoinProps> {
  const { fakeSignInPost } = await import('./live/fakeAuth.js')
  const post: AuthPost = async <T,>(name: string, body: object) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return (await fakeSignInPost(name, body as Record<string, unknown>)) as T
  }
  const search = new URLSearchParams(location.search)
  return { signedIn: !search.has('signIn'), link: location.hash.slice(1), post, entered: () => location.replace('/') }
}

async function realSignIn(): Promise<SignInProps | null> {
  const response = await fetch('/api/auth/state', { cache: 'no-store' }).catch(() => null)
  // No answer or no sign-in on this hub: the page itself says what is wrong.
  if (response === null || !response.ok) return null
  const state = (await response.json()) as AuthState
  if (state.signedIn) return null
  const post: AuthPost = async <T,>(name: string, body: object) => (await sendQuery(name, body)) as T
  return { keySet: state.keySet, passkeyHere: state.passkeyHere, camera: await cameraHere(window), post, entered: () => location.reload() }
}

/**
 * `dev:fake` shows the screen on `?signIn` (`?signIn=nokey` — no owner key on the hub, `?signIn=nopasskeys` — a browser
 * without passkeys, `?signIn=elsewhere` — passkeys made only on other names); signing in drops the parameter.
 */
async function fakeSignIn(): Promise<SignInProps | null> {
  const search = new URLSearchParams(location.search)
  if (!search.has('signIn')) return null
  const { fakeSignInPost } = await import('./live/fakeAuth.js')
  const post: AuthPost = async <T,>(name: string, body: object) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return fakeSignInPost(name, body as Record<string, unknown>) as T
  }
  const keySet = search.get('signIn') !== 'nokey'
  const passkeyHere = search.get('signIn') !== 'elsewhere'
  search.delete('signIn')
  const rest = search.toString()
  return { keySet, passkeyHere, camera: await cameraHere(window), post, entered: () => location.replace(`${location.pathname}${rest === '' ? '' : `?${rest}`}`) }
}

watchTheme()
if (!(await signInShown())) {
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
}
