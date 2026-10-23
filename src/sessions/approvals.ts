import { createHash } from 'node:crypto'
import type { Language } from '../language.js'
import type { Ask } from './ask.js'
import { NO_APPROVAL, permissionAsk, permissionMove, type PermissionMove } from './permission.js'

/** The hook asks every second: a call it has not asked about for this long is no longer waiting on it. */
const STALE_MS = 10_000
/** How long a call is kept whatever its session's status says: the status may lag the dialog. */
const GRACE_MS = 10_000
/** A hook gives up after 29 minutes: a closed call is remembered as long as its hook may still ask. */
const CLOSED_MS = 30 * 60_000
/** Its dialog is the question itself, read and answered as one: a hook of a plugin before 0.11.2 still asks about it. */
const ASK_TOOL = 'AskUserQuestion'

/** What the `PermissionRequest` hook returns to the CLI. */
export type ApprovalDecision = { behavior: 'allow' } | { behavior: 'deny'; message: string }

export interface ApprovalsOptions {
  /** The language a call is put to the user in. */
  language: () => Language
  /** Read at each poll: the chain runs unattended, and nobody approves a call. */
  unattended: () => boolean
  now?: () => number
}

interface Pending {
  key: string
  ask: Ask
  firstSeen: number
  seenAt: number
  decision?: ApprovalDecision
}

/**
 * The tool calls Claude sessions of the chain wait to have approved (BTN-269). The `checkpoint` plugin's
 * `PermissionRequest` hook asks about its call every second while the CLI shows its dialog; the oldest call not yet
 * decided is the session's question on the page, and the answer to it is handed to the hook's next poll. The CLI
 * leaves the hook running when the dialog is answered elsewhere (Remote Control), so a call of a session seen no
 * longer waiting is closed and its hook told to go. In memory: after a service restart the hooks ask again.
 */
export class Approvals {
  private readonly pending = new Map<string, Pending[]>()
  /** By session, then by call: when it was closed. */
  private readonly closed = new Map<string, Map<string, number>>()

  constructor(private readonly options: ApprovalsOptions) {}

  /**
   * The hook's poll, `since` its start (ms): the decision on the call; `null` — it still waits; `undefined` — the
   * call was closed after that hook began, so the dialog it was asked for is gone.
   */
  poll(sessionId: string, tool: string, input: Record<string, unknown>, since: number): ApprovalDecision | null | undefined {
    if (tool === ASK_TOOL) return undefined
    const key = createHash('sha1').update(JSON.stringify([tool, input])).digest('hex').slice(0, 12)
    if ((this.closed.get(sessionId)?.get(key) ?? -Infinity) >= since) return undefined
    const calls = this.live(sessionId)
    const known = calls.find((call) => call.key === key)
    if (this.options.unattended() || known?.decision !== undefined) {
      this.keep(sessionId, calls.filter((call) => call !== known))
      return known?.decision ?? { behavior: 'deny', message: NO_APPROVAL }
    }
    const now = this.now()
    if (known !== undefined) known.seenAt = now
    else this.keep(sessionId, [...calls, { key, ask: permissionAsk(`perm:${sessionId}:${key}`, tool, input, this.options.language()), firstSeen: now, seenAt: now }])
    return null
  }

  /** The call the session waits to have approved, the oldest one, as a question. */
  ask(sessionId: string): Ask | null {
    return this.waiting(sessionId)?.ask ?? null
  }

  /** Decides the oldest waiting call by the user's reply; `null` — none waits. */
  answer(sessionId: string, prompt: string): PermissionMove | null {
    const call = this.waiting(sessionId)
    if (call === undefined) return null
    const move = permissionMove(prompt, call.ask)
    call.decision = move.kind === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: move.message }
    return move
  }

  /** At each read of the sessions: the calls of a session not among `waiting` are closed once past the grace. */
  settle(waiting: ReadonlySet<string>): void {
    const now = this.now()
    for (const [sessionId, closed] of this.closed) {
      for (const [key, at] of closed) if (now - at >= CLOSED_MS) closed.delete(key)
      if (closed.size === 0) this.closed.delete(sessionId)
    }
    for (const sessionId of [...this.pending.keys()]) {
      if (waiting.has(sessionId)) continue
      const [gone, kept] = partition(this.live(sessionId), (call) => now - call.firstSeen >= GRACE_MS)
      if (gone.length === 0) continue
      const closed = this.closed.get(sessionId) ?? new Map<string, number>()
      for (const call of gone) closed.set(call.key, now)
      this.closed.set(sessionId, closed)
      this.keep(sessionId, kept)
    }
  }

  private waiting(sessionId: string): Pending | undefined {
    return this.live(sessionId).find((call) => call.decision === undefined)
  }

  private live(sessionId: string): Pending[] {
    const calls = (this.pending.get(sessionId) ?? []).filter((call) => this.now() - call.seenAt < STALE_MS)
    this.keep(sessionId, calls)
    return calls
  }

  private keep(sessionId: string, calls: Pending[]): void {
    if (calls.length === 0) this.pending.delete(sessionId)
    else this.pending.set(sessionId, calls)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

function partition<T>(items: T[], test: (item: T) => boolean): [T[], T[]] {
  return [items.filter(test), items.filter((item) => !test(item))]
}
