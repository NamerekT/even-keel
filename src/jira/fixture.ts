import type { JiraIssue, JiraRef, JiraStatus } from './model.js'

export const TODO: JiraStatus = { id: '10001', name: 'To Do', statusCategory: { key: 'new' } }
export const BACKLOG: JiraStatus = { id: '10000', name: 'Backlog', statusCategory: { key: 'new' } }
export const PROGRESS: JiraStatus = { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } }
export const DONE: JiraStatus = { id: '10002', name: 'Done', statusCategory: { key: 'done' } }

export const ref = (key: string, status: JiraStatus = TODO): JiraRef => ({ key, fields: { summary: `Issue ${key}`, status } })

export const issue = (key: string, fields: Partial<JiraIssue['fields']> = {}): JiraIssue => ({
  id: `1${key.replace(/\D/g, '')}`,
  key,
  fields: { summary: `Issue ${key}`, status: TODO, priority: { id: '3', name: 'Medium' }, labels: [], fixVersions: [], parent: null, issuelinks: [], subtasks: [], issuetype: { hierarchyLevel: 0 }, ...fields },
})

export const blockedBy = (key: string) => ({ type: { name: 'Blocks' }, inwardIssue: ref(key) })

export interface Reply {
  body?: unknown
  status?: number
}

export function fakeFetch(replies: Reply[]) {
  const calls: { url: string; method: string; headers: Headers; body: Record<string, unknown> | undefined }[] = []
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) })
    const reply = replies.shift()
    if (reply === undefined) throw new Error(`unexpected call: ${init?.method ?? 'GET'} ${url}`)
    const status = reply.status ?? 200
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), { status })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls, remaining: () => replies.length }
}
