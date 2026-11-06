import type { ForgejoComment, ForgejoIssue, ForgejoMilestone } from './model.js'

export const WEB = 'https://git.example.com'
export const REPO = { owner: 'example-org', name: 'app', full_name: 'example-org/app' }

export const milestone = (change: Partial<ForgejoMilestone> = {}): ForgejoMilestone => ({ id: 20, title: 'v1.0', due_on: '2026-11-01T00:00:00Z', state: 'open', ...change })

export const issue = (change: Partial<ForgejoIssue> = {}): ForgejoIssue => ({
  number: 1, title: 'Example issue', body: 'Implement the example.', state: 'open', labels: [{ id: 5, name: 'priority/medium' }], milestone: milestone(), repository: REPO, ...change,
})

export const comment = (id: number, change: Partial<ForgejoComment> = {}): ForgejoComment => ({
  id, body: `Comment ${id}`, created_at: `2026-10-01T00:00:${String(id).padStart(2, '0')}Z`, user: { login: 'john-doe' }, ...change,
})

export interface Route {
  status?: number
  body?: unknown
  /** `x-total-count`; an array body gives its own length unless this says otherwise. */
  total?: number
}
type Handler = Route | ((body: Record<string, unknown> | undefined) => Route)

/**
 * A fake Forgejo answering by `METHOD /path?query` under `/api/v1`, with a first page's `limit=50&page=1` left out of
 * the key: the source asks for dependencies concurrently, so replies by order would not do. An unknown route throws.
 */
export function forgejoFetch(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: Record<string, unknown> | undefined; headers: Headers }[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET'
    const path = String(url).replace(`${WEB}/api/v1`, '').replace(/[?&]limit=50&page=1$/, '')
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as Record<string, unknown>
    calls.push({ method, path, body, headers: new Headers(init?.headers) })
    const handler = routes[`${method} ${path}`]
    if (handler === undefined) throw new Error(`unexpected call: ${method} ${path}`)
    const route = typeof handler === 'function' ? handler(body) : handler
    const status = route.status ?? 200
    const total = route.total ?? (Array.isArray(route.body) ? route.body.length : undefined)
    return new Response(status === 204 ? null : JSON.stringify(route.body ?? null), { status, headers: total === undefined ? {} : { 'x-total-count': String(total) } })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}
