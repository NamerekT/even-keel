import { idPrefixOf, readerIds } from '../config.js'
import type { ServiceContext } from '../service.js'
import { servesTasks } from '../taskmcp/server.js'
import { termsOf, type PromptTracker } from '../taskmcp/vocabulary.js'
import { ADAPTERS } from '../tracker/adapters.js'

export type VocabularyContext = Pick<ServiceContext, 'configStore' | 'readers' | 'linkOf' | 'readerRules'>

/**
 * The project's trackers the tasks tools serve, its own first, each with its terms for a session's prompt (BTN-893). A
 * tracker that is off or did not answer gets no terms: the prompt goes without its line rather than wait for it.
 */
export async function promptTrackers(ctx: VocabularyContext, project: string): Promise<PromptTracker[]> {
  const readers = ctx.readers()
  const served = readerIds(ctx.configStore.current, project).filter((id) => servesTasks(ADAPTERS[readers.trackers[id] ?? '']))
  return Promise.all(
    served.map(async (id) => {
      const link = ctx.linkOf(id)
      const terms = link === undefined ? null : await link.page((tracker) => termsOf(tracker, id, ctx.readerRules(id))).catch(() => null)
      return { prefix: idPrefixOf(readers, id).toUpperCase(), title: ADAPTERS[readers.trackers[id]!]!.title, terms }
    }),
  )
}
