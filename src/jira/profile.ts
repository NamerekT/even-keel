import type { ProfileAccount, TrackerProject } from '../tracker/source.js'
import { JiraApi, siteUrl } from './api.js'

/** The most a `projects` answer lists. */
const LIMIT = 50

/** The profile is named by the site: one account may sign in to several. */
export async function jiraAccount(values: Readonly<Record<string, string>>, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<ProfileAccount> {
  const { user } = await JiraApi.open(values, timeoutMs, fetchImpl)
  const host = new URL(siteUrl(values)).hostname.replace(/\.atlassian\.net$/, '')
  return { login: user.emailAddress || user.displayName, name: `Jira · ${host}`, expiresAt: null }
}

export async function jiraProjects(values: Readonly<Record<string, string>>, query: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<TrackerProject[]> {
  const { api } = await JiraApi.open(values, timeoutMs, fetchImpl)
  const { values: projects } = await api.rest<{ values: { key: string; name: string }[] }>(`/project/search?maxResults=${LIMIT}&query=${encodeURIComponent(query.trim())}`)
  return projects.map((project) => ({ key: project.key, name: project.name }))
}
