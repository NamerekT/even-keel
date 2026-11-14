export { errorReason as oauthReason } from '../error-reason.js'

export class OAuthRefused extends Error {}

/** OAuth errors that a later try may get past; any other OAuth error of a 4xx answer is the provider's refusal. */
const TRANSIENT = new Set(['temporarily_unavailable', 'server_error', 'slow_down'])

/** An OAuth endpoint's 4xx with an OAuth error, such as Atlassian's 403 `unauthorized_client` for a revoked app (BTN-589). */
const rejected = (status: number, error: unknown) =>
  typeof error === 'string' && status >= 400 && status < 500 && status !== 408 && status !== 429 && !TRANSIENT.has(error)

/** Keep only the status and OAuth error field, never a response body or error_description. */
export function oauthHttpError(status: number, error?: unknown, refused = status === 401 || rejected(status, error)): Error {
  const message = `HTTP ${status}${typeof error === 'string' ? `: ${error}` : ''}`
  return refused || ['invalid_grant', 'invalid_client', 'bad_verification_code'].includes(String(error))
    ? new OAuthRefused(message) : new Error(message)
}
