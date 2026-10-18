import { createRequire } from 'node:module'
import { CredentialsRefused, type ProfileAccount, type TrackerProject } from '../tracker/source.js'
import { authOf, readHulyCredentials } from './credentials.js'
import { personName } from './model.js'
import { quietModelNoise } from './quiet.js'

interface SocialId {
  _id: string
  value: string
}

interface Client {
  getAccount(): Promise<{ primarySocialId: string; fullSocialIds?: SocialId[] }>
  findAll<T>(cls: string, query: Record<string, unknown>, options?: { projection?: Record<string, 1> }): Promise<T[]>
  close(): Promise<void>
}

const require = createRequire(import.meta.url)

const PROJECT = 'tracker:class:Project'
const SOCIAL_IDENTITY = 'contact:class:SocialIdentity'
const PERSON = 'contact:class:Person'
/** The most a `projects` answer lists. */
const LIMIT = 50

/**
 * Whether Huly refused the credentials rather than failed to answer: the account service answers a refusal with a
 * platform status (`Unauthorized`, `InvalidPassword`, `AccountNotFound`, `WorkspaceNotFound`), and the API client
 * throws its own text when the login or the workspace comes back empty.
 */
export function refusedBy(error: unknown): boolean {
  const status = (error as { status?: { code?: unknown } } | null)?.status
  if (typeof status?.code === 'string') return true
  const message = error instanceof Error ? error.message : ''
  return /^Login failed$|^Workspace .*not found$/.test(message)
}

async function withClient<T>(values: Readonly<Record<string, string>>, timeoutMs: number, use: (client: Client) => Promise<T>): Promise<T> {
  const credentials = readHulyCredentials(values)
  if (credentials === undefined) throw new Error('huly: the profile has no credentials')
  quietModelNoise()
  const api = require('@hcengineering/api-client') as {
    connect(url: string, options: Record<string, unknown>): Promise<Client>
    NodeWebSocketFactory: unknown
  }
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`huly: no answer in ${timeoutMs} ms`)), timeoutMs)
  })
  const connecting = api.connect(credentials.url, { ...authOf(credentials), socketFactory: api.NodeWebSocketFactory, connectionTimeout: timeoutMs })
  try {
    const client = await Promise.race([connecting, timeout]).catch((error: unknown) => {
      throw refusedBy(error) ? new CredentialsRefused(`huly: ${(error as Error).message}`) : error
    })
    return await Promise.race([use(client), timeout])
  } finally {
    clearTimeout(timer)
    // Also a connection that comes after the timeout: closed, not left open.
    void connecting.then((client) => client.close()).catch(() => undefined)
  }
}

/** Signs in and names the person behind the account; without one in the workspace, the account's primary login. */
export function hulyAccount(values: Readonly<Record<string, string>>, timeoutMs: number): Promise<ProfileAccount> {
  return withClient(values, timeoutMs, async (client) => {
    const account = await client.getAccount()
    const [identity] = await client.findAll<{ attachedTo: string }>(SOCIAL_IDENTITY, { _id: account.primarySocialId }, { projection: { attachedTo: 1 } })
    const [person] =
      identity === undefined ? [] : await client.findAll<{ name: string }>(PERSON, { _id: identity.attachedTo }, { projection: { name: 1 } })
    const login = person?.name ? personName(person.name) : (account.fullSocialIds?.find((id) => id._id === account.primarySocialId)?.value ?? account.primarySocialId)
    return { login, name: `Huly · ${values.HULY_WORKSPACE}`, expiresAt: null }
  })
}

/** The workspace's tracker projects whose identifier or name has the query. */
export function hulyProjects(values: Readonly<Record<string, string>>, query: string, timeoutMs: number): Promise<TrackerProject[]> {
  return withClient(values, timeoutMs, async (client) => {
    const wanted = query.trim().toLowerCase()
    const projects = await client.findAll<{ identifier: string; name: string }>(PROJECT, {}, { projection: { identifier: 1, name: 1 } })
    return projects
      .filter((project) => `${project.identifier}\u0000${project.name}`.toLowerCase().includes(wanted))
      .sort((a, b) => a.identifier.localeCompare(b.identifier))
      .slice(0, LIMIT)
      .map((project) => ({ key: project.identifier, name: project.name }))
  })
}
