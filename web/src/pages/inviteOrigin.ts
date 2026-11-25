import type { KnownOrigin } from '../../../src/access/view.js'

/** A name that reaches only this machine: a link made on it opens nowhere else. */
export function loopbackName(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || hostname === '::1' || /^127\./.test(hostname)
}

/**
 * Where an invitation's link points (BTN-1661, `docs/web/sign-in.md`, "Invitations"): a page opened by an outside
 * name links to itself; one opened by a loopback name never to it — to the hub's outside addresses, the last one seen
 * first, or none and the dialog asks for one.
 */
export type LinkPlace = { kind: 'page'; origin: string } | { kind: 'known'; origins: string[] } | { kind: 'ask' }

export function linkPlaceOf(page: { origin: string; hostname: string }, known: readonly KnownOrigin[]): LinkPlace {
  if (!loopbackName(page.hostname)) return { kind: 'page', origin: page.origin }
  const origins = [...known].sort((a, b) => b.seenAt.localeCompare(a.seenAt)).map((each) => each.origin)
  return origins.length === 0 ? { kind: 'ask' } : { kind: 'known', origins }
}

/** The known addresses with the answer of `invites/origin` over them: a typed address is the last one seen. */
export function withTyped(known: readonly KnownOrigin[], answer: readonly KnownOrigin[]): KnownOrigin[] {
  const merged = new Map(known.map((each) => [each.origin, each]))
  for (const each of answer) merged.set(each.origin, each)
  return [...merged.values()]
}
