import { splitUserMessage } from '../../../src/chain/user-message.js'
import { BOOT_WAIT_MS } from '../../../src/sessions/boot.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import type { ChatHandover } from '../sessionStart.js'

/**
 * How long the window's own press stands for the handover before the service reports one, and how long a handover the
 * service let go waits for the new session's first lines.
 */
export const LOCAL_WAIT_MS = 20_000

/** "New session with this message" pressed in this window: before the service's state says so. */
export interface LocalHandover {
  since: string
  message: string
  /** The session the press was made on. */
  from: string
}

/** The last handover the service reported; `released` — when the service stopped reporting it, epoch ms. */
export type HeldHandover = ChatHandover & { released?: number }

export interface HandoverFacts {
  /** What the service's state says now (`ChainBlock.handover`). */
  server: ChatHandover | null
  local: LocalHandover | null
  /** The last handover the service reported to this window, while the new session's feed is not in yet. */
  held: HeldHandover | null
  /** The session the window shows and the lines read of it. */
  sessionId: string
  lines: FeedLine[] | null | undefined
  now: number
}

/**
 * The handover the chat shows instead of its feed (BTN-1281): from the press until the new session's transcript has its
 * first line, so the old feed never stands for the new session and the new one never shows "Reading". A failed one shows
 * nothing: the old feed comes back with the error.
 */
export function shownHandover({ server, local, held, sessionId, lines, now }: HandoverFacts): ChatHandover | null {
  if (server?.error !== undefined) return null
  const message = server?.message ?? held?.message ?? local?.message ?? null
  if (server !== null) {
    const ready = server.sessionId === sessionId && lines != null && lines.length > 0
    return ready ? null : { ...server, message }
  }
  if (held?.sessionId != null) {
    // An empty read may come before the service was done: the next read brings the first lines, a short wait at most.
    const loaded = held.sessionId === sessionId && (lines === null || (lines !== undefined && lines.length > 0))
    const late = now - Date.parse(held.since) > BOOT_WAIT_MS || (held.released !== undefined && now - held.released > LOCAL_WAIT_MS)
    const { released: _, ...shown } = held
    return loaded || late ? null : { ...shown, message }
  }
  if (held === null && local !== null && local.from === sessionId && now - Date.parse(local.since) < LOCAL_WAIT_MS) {
    return { phase: 'handover', since: local.since, message: local.message, sessionId: null }
  }
  return null
}

/**
 * The feed with the user's message of a `message` handover apart from the handoff prompt it ends (BTN-1281): the first
 * prompt of the session is split in two lines, the handoff and the message.
 */
export function withUserMessage(lines: FeedLine[]): FeedLine[] {
  const at = lines.findIndex((line) => line.kind === 'prompt' || line.kind === 'answer')
  const first = lines[at]
  if (first?.kind !== 'prompt') return lines
  const split = splitUserMessage(first.text)
  if (split === null) return lines
  const { files: _, ...bare } = first
  return lines.toSpliced(at, 1, { ...bare, text: split.handoff }, { ...first, text: split.message })
}
