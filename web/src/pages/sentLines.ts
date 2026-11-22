import type { Mail, MailReason } from '../../../src/sessions/mail.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { withUserMessage } from './chatHandover.js'
import { fileName } from './feedLine.js'

/** A send seen by the window, kept across mailbox and transcript updates. */
export interface SentLine {
  id: number | string
  line: FeedLine
  /** Number of transcript lines already present at a local send. */
  after: number
  midTurn: boolean
  first?: boolean
  failed?: boolean
  returned?: MailReason
  /** Latest mailbox id already present at the send, so a retry cannot claim the original letter. */
  afterMail?: number
  mailId?: number
  queueKey?: string
  hidden?: boolean
  release?: () => void
}

export type Delivery = 'delivering' | 'delivered' | 'failed'

export interface FeedMark {
  key: string | null
  delivery: Delivery
  reason?: MailReason
}

export function sameMessage(a: Pick<FeedLine, 'text' | 'files'>, b: Pick<FeedLine, 'text' | 'files'>): boolean {
  const files = b.files ?? []
  return a.text.trim() === b.text.trim() && (a.files?.length ?? 0) === files.length &&
    files.every((path, index) => fileName(path) === fileName(a.files![index]!))
}

/** Attach server observations to local sends once. A queue entry can leave a poll before its transcript line arrives. */
export function observeMessages(sent: SentLine[], mail: Mail[], queued: FeedLine[]): SentLine[] {
  const next = [...sent]
  for (const letter of mail) {
    if (letter.fate === 'dismissed') continue
    const line: FeedLine = { kind: 'prompt', at: letter.postedAt, text: letter.text, files: letter.files }
    let index = next.findIndex(each => each.mailId === letter.id)
    if (index < 0) index = next.findIndex(each => each.mailId === undefined && each.afterMail !== undefined &&
      each.afterMail < letter.id && !each.failed && matchesUpload(each.line, line))
    const entry = next[index] ?? { id: 'mail-' + letter.id, line, midTurn: true, after: 0 }
    const returned = letter.fate === 'returned' ? (letter.reason ?? 'asked') : undefined
    if (entry.mailId === letter.id && entry.returned === returned) continue
    const updated = { ...entry, mailId: letter.id, line: { ...entry.line, files: letter.files }, returned, failed: returned !== undefined }
    if (index < 0) next.push(updated)
    else next[index] = updated
  }
  const occurrences = new Map<string, number>()
  for (const line of queued) {
    const signature = JSON.stringify([line.at, line.text, line.files])
    const occurrence = occurrences.get(signature) ?? 0
    occurrences.set(signature, occurrence + 1)
    const queueKey = signature + occurrence
    if (next.some(each => each.queueKey === queueKey)) continue
    const index = next.findIndex(each => each.queueKey === undefined && each.midTurn && !each.failed &&
      each.line.at <= line.at && sameMessage(each.line, line))
    if (index < 0) next.push({ id: 'queue-' + queueKey, after: 0, midTurn: true, line, queueKey })
    else next[index] = { ...next[index]!, queueKey }
  }
  return next.length === sent.length && next.every((each, i) => each === sent[i]) ? sent : next
}

/** The inbox can rename colliding files or unpack a zip into a folder. */
export function matchesUpload(local: Pick<FeedLine, 'text' | 'files'>, saved: Pick<FeedLine, 'text' | 'files'>): boolean {
  if (sameMessage(local, saved)) return true
  return local.text.trim() === saved.text.trim() && !!local.files?.length && local.files.length === saved.files?.length &&
    saved.files.every((path, i) => {
      const name = fileName(path).replace(/ \(\d+\)(?=\.[^.]+$|$)/, '')
      const original = fileName(local.files![i]!)
      return name === original || original.toLowerCase().endsWith('.zip') && name === original.slice(0, -4)
    })
}

export function sentFeed(lines: FeedLine[], sent: SentLine[]) {
  const marks = new Map<FeedLine, FeedMark>()
  const shown = withUserMessage(lines)
  for (const line of shown) if (isReply(line)) marks.set(line, { key: null, delivery: 'delivered' })
  const afterOf = (each: SentLine) => each.after + (each.after > 0 ? shown.length - lines.length : 0)
  let unread: SentLine[] = []
  for (const each of sent) {
    if (each.hidden) continue
    const after = afterOf(each)
    const landed = !each.failed && shown.find((line, index) => index >= after && marks.get(line)?.key === null &&
      (typeof each.id === 'number' || line.at >= each.line.at) &&
      (each.first ? (shown === lines || index === shown.findIndex(isReply) + 1) :
        matchesUpload(each.line, line) || (each.line.answers?.ask !== undefined && each.line.answers.ask === line.answers?.ask)))
    if (landed) marks.set(landed, { key: 'sent-' + each.id, delivery: 'delivered' })
    else unread.push(each)
  }
  const expanded = landedTogether(shown, unread, marks, afterOf)
  unread = unread.filter(each => !expanded.taken.has(each))
  const pending = new Map<number, FeedLine[]>()
  for (const each of unread) {
    const line = each.failed ? { ...each.line, answers: undefined } : each.line
    if (each.failed && !line.text && !line.files?.length) continue
    marks.set(line, { key: 'sent-' + each.id, delivery: each.failed ? 'failed' : 'delivering', ...(each.returned && { reason: each.returned }) })
    const later = shown.findIndex((other, index) => index >= afterOf(each) && other.at > line.at)
    const place = later < 0 ? shown.length : later
    const bucket = pending.get(place) ?? []
    bucket.push(line)
    pending.set(place, bucket)
  }
  const all = pending.size || expanded.lines.size
    ? shown.flatMap((line, i) => [...(pending.get(i) ?? []), ...(expanded.lines.get(line) ?? [line])]).concat(pending.get(shown.length) ?? [])
    : shown
  return { all, unread, marks }
}

/**
 * A resume carries every letter its hooks missed as one prompt, so one transcript line holds several sends. The line
 * gives way to the original bubbles, each delivered under its own key.
 */
function landedTogether(shown: FeedLine[], unread: SentLine[], marks: Map<FeedLine, FeedMark>, afterOf: (each: SentLine) => number) {
  const lines = new Map<FeedLine, FeedLine[]>()
  const taken = new Set<SentLine>()
  const letters = unread.filter(each => each.mailId !== undefined && !each.failed)
  if (letters.length < 2) return { lines, taken }
  shown.forEach((line, index) => {
    if (line.kind !== 'prompt' || marks.get(line)?.key !== null) return
    for (let start = 0; start < letters.length; start++) {
      if (taken.has(letters[start]!) || index < afterOf(letters[start]!) || line.at < letters[start]!.line.at) continue
      for (let end = start + 2; end <= letters.length; end++) {
        const run = letters.slice(start, end)
        if (run.some(each => taken.has(each))) break
        const joined = {
          text: run.map(each => each.line.text.trim()).filter(Boolean).join('\n\n'),
          files: run.flatMap(each => each.line.files ?? []),
        }
        if (!matchesUpload(joined, line)) continue
        for (const each of run) {
          taken.add(each)
          marks.set(each.line, { key: 'sent-' + each.id, delivery: 'delivered' })
        }
        lines.set(line, run.map(each => each.line))
        return
      }
    }
  })
  return { lines, taken }
}

export function isReply(line: FeedLine): boolean {
  return line.kind === 'answer' || line.kind === 'prompt'
}
