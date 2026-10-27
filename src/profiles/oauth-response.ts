import { createHash } from 'node:crypto'
import type { ServerResponse } from 'node:http'

const RETURN_SCRIPT = "history.replaceState(null, '', '/settings#trackers'); location.reload()"
const SCRIPT_HASH = createHash('sha256').update(RETURN_SCRIPT).digest('base64')

/** Commit a same-origin page before navigating: Strict cookies stay absent across HTTP redirects. */
export function oauthCallbackPage(response: ServerResponse, status = 200): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'none'; script-src 'sha256-${SCRIPT_HASH}'; base-uri 'none'; frame-ancestors 'none'`,
  }).end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Even Keel</title></head><body><script>${RETURN_SCRIPT}</script><noscript><a href="/settings#trackers" rel="noreferrer">Continue to Even Keel</a></noscript></body></html>`)
}
