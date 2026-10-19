import { createHash } from 'node:crypto'
import { flatten } from '../../src/sessions/entry.js'
import { commandOf, streamsOf, type Call, type Stream, type StreamEvent, type TranscriptEntry } from './stream.js'

export const SIGN_KINDS = ['failures', 'denied', 'repeat', 'reread', 'no_commit', 'rewind', 'compact', 'handoff'] as const
export type SignKind = (typeof SIGN_KINDS)[number]

const MARKERS: ReadonlySet<SignKind> = new Set<SignKind>(['compact', 'handoff'])
const HANDOFF_REASONS: ReadonlySet<string> = new Set(['relay', 'checkpoint', 'restart'])
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const COMMIT = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+commit\b/
const DETAIL_LIMIT = 200
const SIGNS_VERSION = 2

export interface SignRules {
  failureRun: number
  deniedRun: number
  repeatRun: number
  rereadCount: number
  noCommitReplies: number
}

export const DEFAULT_SIGN_RULES: SignRules = { failureRun: 3, deniedRun: 1, repeatRun: 2, rereadCount: 5, noCommitReplies: 150 }

export interface Sign {
  kind: SignKind
  agentId: string | null
  fromUuid: string
  toUuid: string
  fromAt: string
  toAt: string
  count: number
  detail: string
}

export interface Span {
  id: string
  sessionId: string
  agentId: string | null
  fromUuid: string
  toUuid: string
  fromAt: string
  toAt: string
  kinds: SignKind[]
}

export function findSigns(entries: TranscriptEntry[], rules: SignRules, launchReason?: string | null): Sign[] {
  const signs: Sign[] = []
  for (const stream of streamsOf(entries)) {
    const calls = stream.events.flatMap((event) => (event.type === 'call' ? [event.call] : []))
    signs.push(
      ...failureRuns(stream.agentId, calls, (call) => call.result?.isError === true, 'failures', rules.failureRun),
      ...failureRuns(stream.agentId, calls, (call) => call.result?.kind === 'denied', 'denied', rules.deniedRun),
      ...repeats(stream.agentId, calls, rules.repeatRun),
      ...segmentsOf(stream).flatMap((segment) => rereads(stream.agentId, segment, rules.rereadCount)),
      ...rewinds(stream),
      ...stream.events.flatMap((event) => (event.type === 'compact' ? [point('compact', stream.agentId, event, 'compacted')] : [])),
    )
    if (stream.agentId !== null) continue
    signs.push(...stretchesWithoutCommit(stream, rules.noCommitReplies))
    const first = stream.events[0]
    if (first !== undefined && launchReason != null && HANDOFF_REASONS.has(launchReason)) {
      signs.push(point('handoff', null, first, launchReason))
    }
  }
  return signs.sort((a, b) => (a.agentId ?? '').localeCompare(b.agentId ?? '') || a.fromAt.localeCompare(b.fromAt))
}

export function signKey(rules: SignRules, launchReason: string | null): string {
  const ordered = Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b)))
  return createHash('sha1').update(JSON.stringify([SIGNS_VERSION, ordered, launchReason])).digest('hex')
}

export function spansOf(sessionId: string, signs: Sign[]): Span[] {
  const spans: Span[] = []
  const agents = [...new Set(signs.map((sign) => sign.agentId))]
  for (const agentId of agents) {
    const own = signs.filter((sign) => sign.agentId === agentId)
    const merged: (Omit<Span, 'id' | 'kinds'> & { kinds: Set<SignKind> })[] = []
    for (const sign of own.filter((item) => !MARKERS.has(item.kind)).sort((a, b) => a.fromAt.localeCompare(b.fromAt))) {
      const last = merged.at(-1)
      if (last !== undefined && sign.fromAt <= last.toAt) {
        last.kinds.add(sign.kind)
        if (sign.toAt > last.toAt) Object.assign(last, { toAt: sign.toAt, toUuid: sign.toUuid })
        continue
      }
      const { fromUuid, toUuid, fromAt, toAt } = sign
      merged.push({ sessionId, agentId, fromUuid, toUuid, fromAt, toAt, kinds: new Set([sign.kind]) })
    }
    for (const marker of own.filter((item) => MARKERS.has(item.kind))) {
      merged.find((span) => span.fromAt <= marker.fromAt && marker.fromAt <= span.toAt)?.kinds.add(marker.kind)
    }
    for (const span of merged) {
      const id = createHash('sha1').update([sessionId, agentId ?? '', span.fromUuid, span.toUuid].join('\n')).digest('hex')
      spans.push({ ...span, id, kinds: [...span.kinds].sort() })
    }
  }
  return spans
}

function failureRuns(agentId: string | null, calls: Call[], failed: (call: Call) => boolean, kind: SignKind, min: number): Sign[] {
  const signs: Sign[] = []
  let run: Call[] = []
  const flush = () => {
    if (run.length >= min) {
      const text = flatten(run[0]!.result?.text ?? '', DETAIL_LIMIT)
      signs.push(span(kind, agentId, run, `${countNames(run)}: ${text}`))
    }
    run = []
  }
  for (const call of calls) {
    if (failed(call)) run.push(call)
    else flush()
  }
  flush()
  return signs
}

function repeats(agentId: string | null, calls: Call[], min: number): Sign[] {
  const signs: Sign[] = []
  let seen = new Map<string, Call[]>()
  const flush = () => {
    for (const [command, runs] of seen) if (runs.length >= min) signs.push(span('repeat', agentId, runs, flatten(command, DETAIL_LIMIT)))
    seen = new Map()
  }
  for (const call of calls) {
    if (EDIT_TOOLS.has(call.name)) {
      flush()
      continue
    }
    const command = commandOf(call)
    if (command === null) continue
    const key = command.replace(/\s+/g, ' ').trim()
    seen.set(key, [...(seen.get(key) ?? []), call])
  }
  flush()
  return signs
}

/** The calls of a stream split at its compactions: after one the agent has lost what it read, as a new session has. */
function segmentsOf(stream: Stream): Call[][] {
  const segments: Call[][] = [[]]
  for (const event of stream.events) {
    if (event.type === 'compact') segments.push([])
    else if (event.type === 'call') segments.at(-1)!.push(event.call)
  }
  return segments
}

function rereads(agentId: string | null, calls: Call[], min: number): Sign[] {
  const reads = new Map<string, Call[]>()
  for (const call of calls) {
    const path = call.input.file_path
    if (call.name !== 'Read' || typeof path !== 'string') continue
    const key = path.replace(/\\/g, '/').toLowerCase()
    reads.set(key, [...(reads.get(key) ?? []), call])
  }
  return [...reads].filter(([, list]) => list.length >= min).map(([path, list]) => span('reread', agentId, list, flatten(path, DETAIL_LIMIT)))
}

function stretchesWithoutCommit(stream: Stream, min: number): Sign[] {
  const signs: Sign[] = []
  let replies: StreamEvent[] = []
  const flush = () => {
    if (replies.length >= min) {
      const first = replies[0]!
      const last = replies.at(-1)!
      signs.push({ kind: 'no_commit', agentId: stream.agentId, fromUuid: first.uuid, toUuid: last.uuid, fromAt: first.at, toAt: last.at, count: replies.length, detail: '' })
    }
    replies = []
  }
  for (const event of stream.events) {
    if (event.type === 'reply') replies.push(event)
    if (event.type === 'call' && event.call.result?.isError === false && COMMIT.test(commandOf(event.call) ?? '')) flush()
  }
  flush()
  return signs
}

function rewinds(stream: Stream): Sign[] {
  const children = new Map<string, Extract<StreamEvent, { type: 'prompt' }>[]>()
  for (const event of stream.events) {
    if (event.type !== 'prompt' || event.parent === null) continue
    children.set(event.parent, [...(children.get(event.parent) ?? []), event])
  }
  return [...children.values()]
    .filter((prompts) => prompts.length > 1)
    .map((prompts) => {
      const first = prompts[0]!
      const last = prompts.at(-1)!
      return {
        kind: 'rewind' as const,
        agentId: stream.agentId,
        fromUuid: first.uuid,
        toUuid: last.uuid,
        fromAt: first.at,
        toAt: last.at,
        count: prompts.length - 1,
        detail: flatten(first.text, DETAIL_LIMIT),
      }
    })
}

function span(kind: SignKind, agentId: string | null, calls: Call[], detail: string): Sign {
  const first = calls[0]!
  const last = calls.at(-1)!
  return { kind, agentId, fromUuid: first.uuid, toUuid: last.uuid, fromAt: first.at, toAt: last.at, count: calls.length, detail }
}

function point(kind: SignKind, agentId: string | null, event: StreamEvent, detail: string): Sign {
  return { kind, agentId, fromUuid: event.uuid, toUuid: event.uuid, fromAt: event.at, toAt: event.at, count: 1, detail }
}

function countNames(calls: Call[]): string {
  const counts = new Map<string, number>()
  for (const call of calls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
  return [...counts].map(([name, count]) => (count > 1 ? `${name}×${count}` : name)).join(', ')
}
