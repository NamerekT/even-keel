import { CredentialsRefused, TrackerNotFound, type ProfileAccount, type TrackerProject } from '../tracker/source.js'
import { GitlabApi, GITLAB_TOKEN, webUrl } from './api.js'

export async function gitlabAccount(values: Readonly<Record<string, string>>, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<ProfileAccount> {
  const api = new GitlabApi(webUrl(values), values[GITLAB_TOKEN] ?? '', timeoutMs, fetchImpl)
  const user = await api.rest<{ username: string }>('/user')
  let expiresAt: string | null = null
  try {
    const token = await api.rest<{ expires_at: string | null; scopes: string[] }>('/personal_access_tokens/self')
    if (!token.scopes.includes('api')) throw new CredentialsRefused('gitlab: the personal access token needs the api scope')
    if (token.expires_at !== null && Number.isFinite(Date.parse(token.expires_at))) expiresAt = new Date(token.expires_at).toISOString()
  } catch (error) {
    if (!(error instanceof TrackerNotFound)) throw error
  }
  return { login: user.username, name: `GitLab · ${user.username}`, expiresAt }
}

export async function gitlabProjects(values: Readonly<Record<string, string>>, query: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<TrackerProject[]> {
  const api = new GitlabApi(webUrl(values), values[GITLAB_TOKEN] ?? '', timeoutMs, fetchImpl)
  const wanted = query.trim().toLowerCase()
  const projects = await api.collect<{ path_with_namespace: string; name: string }>('/projects?membership=true&simple=true&order_by=last_activity_at&sort=desc')
  return projects.filter((project) => `${project.path_with_namespace} ${project.name}`.toLowerCase().includes(wanted)).slice(0, 50).map((project) => ({ key: project.path_with_namespace, name: project.name }))
}
