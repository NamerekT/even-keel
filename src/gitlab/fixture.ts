import type { GitlabIssue, GitlabLink, GitlabNote } from './model.js'

export const issue = (change: Partial<GitlabIssue> = {}): GitlabIssue => ({
  id: 100 + (change.iid ?? 1), iid: 1, project_id: 10, title: 'Example issue', state: 'opened', description: 'Implement the example.', labels: ['priority::medium'],
  web_url: 'https://gitlab.example.com/group/subgroup/app/-/issues/1', milestone: { id: 20, title: 'v1.0', due_date: '2026-11-01', state: 'active' }, ...change,
})

export const linked = (link_type: GitlabLink['link_type'], iid: number, path = 'group/subgroup/app'): GitlabLink => ({ link_type, iid, title: `Issue ${iid}`, state: 'opened', web_url: `https://gitlab.example.com/${path}/-/issues/${iid}` })
export const note = (id: number, change: Partial<GitlabNote> = {}): GitlabNote => ({ id, body: `Note ${id}`, system: false, author: { id: 9, username: 'example-user' }, created_at: `2026-10-01T00:00:${String(id).padStart(2, '0')}Z`, ...change })

export interface Reply { body: unknown; status?: number; next?: string }
export function fakeFetch(replies: Reply[]) {
  const calls: { url: string; method: string; headers: Headers; body: Record<string, unknown> | undefined; redirect: RequestRedirect | undefined }[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)), redirect: init?.redirect })
    const reply = replies.shift()
    if (reply === undefined) throw new Error(`unexpected call: ${url}`)
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: reply.next === undefined ? {} : { 'x-next-page': reply.next } })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls, remaining: () => replies.length }
}
