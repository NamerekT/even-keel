import { idPrefixOf, readerIds } from '../config.js'
import type { ServiceContext } from '../service.js'
import { servesTasks } from '../taskmcp/server.js'
import { termsOf, type PromptTracker } from '../taskmcp/vocabulary.js'
import { ADAPTERS } from '../tracker/adapters.js'
import { errorText } from '../tracker/link.js'

export type VocabularyContext = Pick<ServiceContext, 'configStore' | 'readers' | 'linkOf' | 'readerRules'>

/**
 * The project's trackers the tasks tools serve, its own first, each with its terms for a session's prompt (BTN-893). A
 * tracker that is off, did not answer or refused its vocabulary gets no terms: the prompt goes without its line rather
 * than wait for it, and the log says whose line and why (EKR-106). A refusal is the read's own and puts no tracker down.
 */
export async function promptTrackers(ctx: VocabularyContext, project: string): Promise<PromptTracker[]> {
  const readers = ctx.readers()
  const served = readerIds(ctx.configStore.current, project).filter((id) => servesTasks(ADAPTERS[readers.trackers[id] ?? '']))
  return Promise.all(
    served.map(async (id) => {
      const prefix = idPrefixOf(readers, id).toUpperCase()
      const link = ctx.linkOf(id)
      const terms = link === undefined ? null : await link.aside((tracker) => termsOf(tracker, id, ctx.readerRules(id))).catch((error: unknown) => {
        console.error(`prompt: the ${prefix} chain line is left out: ${errorText(error)}`)
        return null
      })
      return { prefix, title: ADAPTERS[readers.trackers[id]!]!.title, terms }
    }),
  )
}
