export class OAuthRefused extends Error {}

/** Keep only the status and OAuth error field, never a response body or error_description. */
export function oauthHttpError(status: number, error?: unknown, refused = status === 401): Error {
  const message = `HTTP ${status}${typeof error === 'string' ? `: ${error}` : ''}`
  return refused || ['invalid_grant', 'invalid_client', 'bad_verification_code'].includes(String(error))
    ? new OAuthRefused(message) : new Error(message)
}

export function oauthReason(error: unknown, secrets: readonly (string | null | undefined)[]): string {
  let message = error instanceof Error ? error.message || error.name : typeof error === 'string' ? error : 'Unknown error'
  const values = secrets.filter((value): value is string => !!value).flatMap((value) => [value, encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2)])
  for (const value of [...new Set(values)].sort((a, b) => b.length - a.length)) message = message.replaceAll(value, '[redacted]')
  return message.replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]')
    .replace(/\b(code|state|access_token|refresh_token|client_secret|code_verifier)\s*[=:]\s*[^\s&,;]+/gi, '$1=[redacted]')
    .replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500)
}
