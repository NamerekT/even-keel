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
  const response = await fetchImpl(`${forgejoBase(url)}/api/v1/user`, {
    headers: { authorization: `token ${values[FORGEJO_TOKEN] ?? ''}`, accept: 'application/json', 'user-agent': 'even-keel' },
    signal: AbortSignal.timeout(timeoutMs),
  })
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
