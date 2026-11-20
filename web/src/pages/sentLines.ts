import type { FeedLine } from '../../../src/sessions/transcript.js'
import { withUserMessage } from './chatHandover.js'

/**
 * A reply sent from the chat window, shown until the transcript has a prompt or an answer after the line it was sent at;
 * `steered` — it went straight into the working session, which is not respawned with it, and shows as queued, not in the
 * feed; `failed` — the server refused it: it stays in the feed, marked, until the next send.
 */
export interface SentLine {
  /** Unique in the window: the feed keys the line by it, and the transcript line that lands for it takes the same key. */
  id: number
  line: FeedLine
  after: number
  steered: boolean
  first?: boolean
  failed?: boolean
  /** Lets the line's local pictures go once it leaves the feed. */
  release?: () => void
}

/** The mark under the user's message: on its way, in the session, or refused (BTN-1362). */
export type Delivery = 'delivering' | 'delivered' | 'failed'

export interface FeedMark {
  /** The feed entry's key, `null` — none of its own: the line came from the transcript without a send from here. */
  key: string | null
  delivery: Delivery
}

export interface SentFeed {
  /** The transcript's lines and, after them, the sent ones it does not hold yet. */
  all: FeedLine[]
  /** The sent lines the transcript does not hold: still on their way, or refused. */
  unread: SentLine[]
  /** For every user line of `all`, by the line itself. */
  marks: Map<FeedLine, FeedMark>
}

/**
 * The feed with the window's sent lines in it. A sent line and the transcript line that lands for it share a key, so the
 * bubble stays the same element and only its mark changes, however the lines around it shift.
 */
export function sentFeed(lines: FeedLine[], sent: SentLine[]): SentFeed {
  const unread = sent.filter((each) => each.failed === true || !lines.slice(each.after).some(isReply))
  const keys = new Map<FeedLine, string>()
  const claimed = new Set<number>()
  for (const each of sent) {
    if (unread.includes(each)) continue
    const at = lines.findIndex((line, index) => index >= each.after && !claimed.has(index) && isReply(line))
    if (at < 0) continue
    claimed.add(at)
    keys.set(lines[at]!, `sent-${each.id}`)
  }
  const shown = withUserMessage(lines)
  if (shown.length > lines.length) {
    // The first prompt was split into the handoff and the user's message: the message is the line that was sent.
    const at = lines.findIndex(isReply)
    const key = keys.get(lines[at]!)
    if (key !== undefined) keys.set(shown[at + 1]!, key)
  }
  const marks = new Map<FeedLine, FeedMark>()
  for (const line of shown) if (isReply(line)) marks.set(line, { key: keys.get(line) ?? null, delivery: 'delivered' })
  const pending: FeedLine[] = []
  for (const each of unread) {
    if (each.steered) continue
    const line = each.failed === true ? { ...each.line, answers: undefined } : each.line
    if (each.failed === true && line.text === '' && (line.files?.length ?? 0) === 0) continue
    marks.set(line, { key: `sent-${each.id}`, delivery: each.failed === true ? 'failed' : 'delivering' })
    pending.push(line)
  }
  return { all: [...shown, ...pending], unread, marks }
}

export function isReply(line: FeedLine): boolean {
  return line.kind === 'answer' || line.kind === 'prompt'
}
