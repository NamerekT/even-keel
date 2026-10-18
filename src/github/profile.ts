import { CredentialsRefused, type ProfileAccount, type TrackerProject } from '../tracker/source.js'
import { GITHUB_TOKEN } from './adapter.js'

const API = 'https://api.github.com'
/** The most a `projects` answer lists. */
const LIMIT = 50

interface Repository {
  full_name: string
  name: string
  owner: { login: string }
}

async function rest(path: string, token: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<Response> {
  const response = await fetchImpl(`${API}${path}`, {
    headers: { authorization: `bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'even-keel' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.status === 401) {
    await response.body?.cancel()
    throw new CredentialsRefused('github: the token is refused (HTTP 401)')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(`github: HTTP ${response.status}${body.message ? `: ${body.message}` : ''}`)
  }
  return response
}

const repositories = async (token: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<Repository[]> =>
  (await (await rest('/user/repos?per_page=100&sort=updated', token, timeoutMs, fetchImpl)).json()) as Repository[]

/** GitHub's `2026-11-01 12:00:00 UTC` (or with an offset) as ISO; `null` when the header is missing or unreadable. */
export function expirationOf(header: string | null): string | null {
  const match = header?.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ?(UTC|[+-]\d{2}:?\d{2})?$/)
  if (!match) return null
  const zone = match[3] === undefined || match[3] === 'UTC' ? 'Z' : match[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
  const at = new Date(`${match[1]}T${match[2]}${zone}`)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

/** A token that sees one owner's repositories (a fine-grained token) is named by the owner, else by its login. */
export async function githubAccount(values: Readonly<Record<string, string>>, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<ProfileAccount> {
  const token = values[GITHUB_TOKEN] ?? ''
  const response = await rest('/user', token, timeoutMs, fetchImpl)
  const user = (await response.json()) as { login: string }
  const owners = [...new Set((await repositories(token, timeoutMs, fetchImpl)).map((repo) => repo.owner.login))]
  return {
    login: user.login,
    name: `GitHub · ${owners.length === 1 ? owners[0] : user.login}`,
    expiresAt: expirationOf(response.headers.get('github-authentication-token-expiration')),
  }
}

/** The repositories the token sees, most recently updated first: `owner/name` is what a project's entry takes. */
export async function githubProjects(values: Readonly<Record<string, string>>, query: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<TrackerProject[]> {
  const wanted = query.trim().toLowerCase()
  return (await repositories(values[GITHUB_TOKEN] ?? '', timeoutMs, fetchImpl))
    .filter((repo) => repo.full_name.toLowerCase().includes(wanted))
    .slice(0, LIMIT)
    .map((repo) => ({ key: repo.full_name, name: repo.name }))
}
