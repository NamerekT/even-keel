import type { TranscriptReads } from '../machine/services.js'
import { fail } from '../notice/notice.js'

export interface SessionTranscriptsDeps {
  own: () => string
  /** The machine that holds or ran the session; `undefined` — none known, the own machine looks. */
  sessionMachine: (sessionId: string) => string | undefined
  ownReads: TranscriptReads
  /** The reads of a machine elsewhere over the link; `undefined` — it is off the link or has no mirror. */
  elsewhere: (machine: string) => TranscriptReads | undefined
  /** The machine's name for a person to read. */
  nameOf: (machine: string) => Promise<string>
}

/**
 * The hub's reads of a session's transcript, made on the machine of the session (BTN-1574): the own machine's for its
 * own sessions and the unknown ones, a machine elsewhere's over the link for the sessions it holds — so the own machine
 * never searches its account folders for a session it does not have. A machine off the link answers
 * `machines.transcriptOffline`, not "not found".
 */
export function sessionTranscripts(deps: SessionTranscriptsDeps): TranscriptReads {
  const readsOf = async (sessionId: string): Promise<TranscriptReads> => {
    const machine = deps.sessionMachine(sessionId)
    if (machine === undefined || machine === deps.own()) return deps.ownReads
    const reads = deps.elsewhere(machine)
    if (reads === undefined) throw fail('machines.transcriptOffline', { name: await deps.nameOf(machine) })
    return reads
  }
  return {
    record: async (sessionId) => (await readsOf(sessionId)).record(sessionId),
    feed: async (sessionId, after) => (await readsOf(sessionId)).feed(sessionId, after),
    image: async (sessionId, tool, index) => (await readsOf(sessionId)).image(sessionId, tool, index),
    inboxFile: async (sessionId, name) => (await readsOf(sessionId)).inboxFile(sessionId, name),
    sharedFile: async (sessionId, tool, index) => (await readsOf(sessionId)).sharedFile(sessionId, tool, index),
    note: async (sessionId) => (await readsOf(sessionId)).note(sessionId),
    context: async (sessionId) => (await readsOf(sessionId)).context(sessionId),
  }
}
