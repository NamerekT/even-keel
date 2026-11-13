import type { ServerResponse } from 'node:http'

const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

/** OAuth replaces the CSP with its hashed return script; attachments keep their own policy. */
export function securePage(response: ServerResponse): void {
  response.setHeader('content-security-policy', PAGE_POLICY)
  response.setHeader('x-frame-options', 'DENY')
  response.setHeader('referrer-policy', 'no-referrer')
}
