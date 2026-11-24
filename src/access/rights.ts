/**
 * What a device token may do on the page and in MCP (`access_tokens.rights`, `docs/storage.md`). Only the owner for
 * now; BTN-502 adds narrower rights for other people.
 */
export type Rights = 'owner'

/** Whether a token of these rights may act. Every route and tool asks this one function, so narrower rights land here. */
export function permits(rights: string): rights is Rights {
  return rights === 'owner'
}
