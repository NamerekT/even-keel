/** The part of the Huly client's markup operations the public client does not expose (`@hcengineering/api-client` 0.7.423). */
interface MarkupInternals {
  refUrl: string
  imageUrl: string
  collaborator: { updateMarkup(doc: { objectClass: string; objectId: string; objectAttr: string }, markup: string): Promise<void> }
}

export interface CollabModules {
  markdownToMarkup(markdown: string, options: { refUrl: string; imageUrl: string }): unknown
  jsonToMarkup(json: unknown): string
}

export type UpdateMarkup = (cls: string, id: string, attribute: string, markdown: string, format: 'markdown') => Promise<void>

/**
 * `updateMarkup` of a connected Huly client: the collaborator's `updateContent`, which rewrites the document in place.
 * The client keeps its collaborator private, so it is read from the pinned version's internals; a client without them
 * fails the write loudly rather than leave a description unwritten (BTN-906).
 */
export function collabUpdater(client: object, modules: CollabModules): UpdateMarkup {
  return async (cls, id, attribute, markdown) => {
    const markup = (client as { markup?: Partial<MarkupInternals> }).markup
    if (typeof markup?.collaborator?.updateMarkup !== 'function' || typeof markup.refUrl !== 'string' || typeof markup.imageUrl !== 'string') {
      throw new Error('the Huly client has no collaborator to write a description with: its version is not the one Even Keel is tested with')
    }
    const json = modules.markdownToMarkup(markdown, { refUrl: markup.refUrl, imageUrl: markup.imageUrl })
    await markup.collaborator.updateMarkup({ objectClass: cls, objectId: id, objectAttr: attribute }, modules.jsonToMarkup(json))
  }
}
