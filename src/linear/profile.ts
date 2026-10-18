import { CredentialsRefused, type ProfileAccount, type TrackerProject } from '../tracker/source.js'
import { LINEAR_TOKEN } from './adapter.js'

const API = 'https://api.linear.app/graphql'
/** The most a `projects` answer lists. */
const LIMIT = 50

const ACCOUNT = '{ viewer { name email } organization { name } }'
const TEAMS = '{ teams(first: 100) { nodes { key name projects(first: 100) { nodes { name } } } } }'

interface GraphqlError {
  message: string
  extensions?: { code?: string; type?: string }
}

const refusal = (error: GraphqlError) => error.extensions?.code === 'AUTHENTICATION_ERROR' || /authenticat/i.test(error.extensions?.type ?? '')

async function graphql<T>(query: string, token: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(API, {
    method: 'POST',
    headers: { authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = (await response.json().catch(() => ({}))) as { data?: T | null; errors?: GraphqlError[] }
  const errors = body.errors ?? []
  const text = errors.map((error) => error.message).join('; ')
  if (response.status === 401 || errors.some(refusal)) throw new CredentialsRefused(`linear: the key is refused${text ? `: ${text}` : ''}`)
  if (!response.ok) throw new Error(`linear: HTTP ${response.status}${text ? `: ${text}` : ''}`)
  if (text || body.data == null) throw new Error(`linear: ${text || 'empty answer'}`)
  return body.data
}

/** A Linear key belongs to one workspace: the profile is named by it. */
export async function linearAccount(values: Readonly<Record<string, string>>, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<ProfileAccount> {
  const { viewer, organization } = await graphql<{ viewer: { name: string; email: string | null }; organization: { name: string } }>(
    ACCOUNT,
    values[LINEAR_TOKEN] ?? '',
    timeoutMs,
    fetchImpl,
  )
  return { login: viewer.email || viewer.name, name: `Linear · ${organization.name}`, expiresAt: null }
}

/** The teams and each team's projects: a team is an entry's key, a project narrows the team to it (`within`). */
export async function linearProjects(values: Readonly<Record<string, string>>, query: string, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<TrackerProject[]> {
  const { teams } = await graphql<{ teams: { nodes: { key: string; name: string; projects: { nodes: { name: string }[] } }[] } }>(
    TEAMS,
    values[LINEAR_TOKEN] ?? '',
    timeoutMs,
    fetchImpl,
  )
  const wanted = query.trim().toLowerCase()
  const has = (...texts: string[]) => texts.some((text) => text.toLowerCase().includes(wanted))
  return teams.nodes
    .flatMap((team): TrackerProject[] => [
      { key: team.key, name: team.name },
      ...team.projects.nodes.map((project) => ({ key: team.key, name: project.name, within: project.name })),
    ])
    .filter((entry) => has(entry.key, entry.name))
    .slice(0, LIMIT)
}
