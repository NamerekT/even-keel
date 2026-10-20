import type { ProfileKind } from '../profiles/model.js'
import { CredentialsRefused, type ProfileAccount } from '../tracker/source.js'

export const FORGEJO_URL = 'FORGEJO_URL'
export const FORGEJO_TOKEN = 'FORGEJO_TOKEN'

/** A server's address as the API is asked at: with a scheme (`https://` when it has none), without a trailing slash. */
export function forgejoBase(url: string): string {
  const trimmed = url.trim()
  return (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).replace(/\/+$/, '')
}

/** The host of a profile's address or of a remote's web address, lowercase; `null` — none can be read. */
export function hostOf(url: string): string | null {
  try {
    return new URL(forgejoBase(url)).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/** Whom the token signs in as. The user is read with `read:user`, so a token without that right is refused too. */
export async function forgejoAccount(values: Readonly<Record<string, string>>, timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<ProfileAccount> {
  const url = values[FORGEJO_URL] ?? ''
  const ask = (path: string) =>
    fetchImpl(`${forgejoBase(url)}/api/v1/${path}`, {
      headers: { authorization: `token ${values[FORGEJO_TOKEN] ?? ''}`, accept: 'application/json', 'user-agent': 'even-keel' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  await assertForgejo(await ask('version'), url)
  const response = await ask('user')
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel()
    throw new CredentialsRefused(
      response.status === 401 ? 'forgejo: the token is refused (HTTP 401)' : 'forgejo: the token may not read its user (HTTP 403): it needs read:user',
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`forgejo: HTTP ${response.status}`)
  }
  const user = (await response.json()) as { login: string }
  return { login: user.login, name: nameOf(url), expiresAt: null }
}

const nameOf = (url: string): string => `Forgejo · ${hostOf(url) ?? url}`

/**
 * A remote on an unknown domain is taken for Forgejo (`remoteKind`), so the profile's check is where a GitLab or another
 * forge is told apart (EKR-8): Forgejo and Gitea answer `/api/v1/version` with `{ version }` in JSON, and refuse a
 * token there in JSON too — on a server that wants a sign-in for its API. That refusal and a server error are left to
 * the user's request, which says what they are. gitlab.com redirects to its sign-in page, an HTML one.
 */
async function assertForgejo(response: Response, url: string): Promise<void> {
  const json = /\bjson\b/i.test(response.headers.get('content-type') ?? '')
  if (response.status >= 500 || (json && (response.status === 401 || response.status === 403))) {
    await response.body?.cancel()
    return
  }
  const body: unknown = response.ok && json ? await response.json().catch(() => null) : await response.body?.cancel()
  if (typeof (body as { version?: unknown } | null)?.version !== 'string') {
    throw new Error(`forgejo: ${hostOf(url) ?? url} is not a Forgejo or Gitea server: /api/v1/version gave no version (HTTP ${response.status})`)
  }
}

/**
 * Forgejo as a profile's kind (BTN-201): a server's address and a token that reads its repositories and their Actions.
 * It is no tracker: the CI of a remote on the profile's host takes its token (`ciToken`).
 */
export const FORGEJO_PROFILE: ProfileKind = {
  title: 'Forgejo',
  variables: [FORGEJO_URL, FORGEJO_TOKEN],
  hostVariables: [FORGEJO_URL],
  help: 'https://forgejo.org/docs/latest/user/token-scope/',
  profileName: (values) => nameOf(values[FORGEJO_URL] ?? ''),
  account: (values, timeoutMs) => forgejoAccount(values, timeoutMs),
  complete(values) {
    const url = values[FORGEJO_URL]
    if (!url && !values[FORGEJO_TOKEN]) return false
    if (!url || !values[FORGEJO_TOKEN]) throw new Error(`forgejo: ${FORGEJO_URL} and ${FORGEJO_TOKEN} go together`)
    if (hostOf(url) === null) throw new Error(`forgejo: ${FORGEJO_URL} is not an address: ${url}`)
    return true
  },
}
