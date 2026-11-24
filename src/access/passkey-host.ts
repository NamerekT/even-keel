/**
 * Whether a page host name can be a passkey's RP ID: WebAuthn takes a domain (`localhost` too), never an IP address
 * (BTN-1632). `host` is a URL's hostname — as `hostnameOf` or `location.hostname` give it, IPv6 with or without brackets.
 * Shared by the server and the page: no `node:*` here.
 */
export function passkeyHost(host: string): boolean {
  if (host === '' || host.includes(':')) return false
  return !/^\d+\.\d+\.\d+\.\d+$/.test(host)
}
