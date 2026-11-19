import { connect } from 'node:net'
import type { Language } from '../language.js'
import { mailMessage, type NoteOf } from './mail.js'
import type { Mailbox } from './mailbox.js'

/** How long a write may take before the inbox is taken for dead and the message goes the old way. */
const WRITE_MS = 2000
/** The sessions remembered at most: a machine's hooks report every session started there, the user's own too. */
const KEPT = 500

/**
 * An address a session's inbox can have (`messagingSocketPath`): a named pipe on Windows, a socket's absolute path
 * elsewhere. Anything else a hook reports is refused, so a message never goes to a file or a pipe of another kind.
 */
export function inboxPathOk(path: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') return /^\\\\\.\\pipe\\[^\\]/i.test(path)
  return path.startsWith('/')
}

/**
 * Writes `text` into a Claude Code session's inbox socket as the CLI reads it (BTN-1322, `docs/sessions/chat.md`,
 * "The inbox socket"): lines of JSON, the auth line first, then the message. Resolves once the lines are written.
 */
function writeInbox(path: string, token: string, text: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const socket = connect(path)
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error === undefined) resolve()
      else {
        socket.destroy()
        reject(error)
      }
    }
    const timer = setTimeout(() => finish(new Error('the inbox did not take the message in time')), timeoutMs)
    socket.on('error', (error) => finish(error))
    socket.once('connect', () => {
      const lines = `${JSON.stringify({ type: 'auth', token })}\n${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`
      socket.write(lines, (error) => {
        finish(error ?? undefined)
        if (error == null) socket.end()
      })
    })
  })
}

/**
 * The inbox sockets of the live Claude sessions of this machine, as their `SessionStart` hook reported them: the
 * address and the token, in memory only — the token is the session's key, never written to the database or the log.
 * A new process of the session (a resume) reports a new pair; one whose write failed is forgotten until then.
 */
export class Inboxes {
  private readonly known = new Map<string, { path: string; token: string }>()

  constructor(
    private readonly timeoutMs = WRITE_MS,
    private readonly kept = KEPT,
  ) {}

  /** `false` — no inbox socket's address, or no token: nothing is remembered. */
  remember(sessionId: string, path: string, token: string): boolean {
    if (!inboxPathOk(path) || token === '') return false
    this.known.delete(sessionId)
    this.known.set(sessionId, { path, token })
    for (const oldest of this.known.keys()) {
      if (this.known.size <= this.kept) break
      this.known.delete(oldest)
    }
    return true
  }

  knows(sessionId: string): boolean {
    return this.known.has(sessionId)
  }

  /** Rejects when the session has no inbox known here or the write failed; a failed one is forgotten. */
  async tell(sessionId: string, text: string): Promise<void> {
    const inbox = this.known.get(sessionId)
    if (inbox === undefined) throw new Error(`no inbox is known for the session ${sessionId}`)
    try {
      await writeInbox(inbox.path, inbox.token, text, this.timeoutMs)
    } catch (error) {
      if (this.known.get(sessionId) === inbox) this.known.delete(sessionId)
      throw error
    }
  }
}

export interface InboxMail {
  mailbox: Mailbox
  inboxes: Inboxes
  language: () => Language
  note?: NoteOf
  log?: (line: string) => void
}

/**
 * The chat's message into the session's inbox (BTN-1322): a row of the mailbox, for its mark and the chat window's
 * delivery, delivered with the event `inbox` once the write is done. `false` — no inbox known, or the write failed:
 * the row is dismissed and the caller takes the old way (the mailbox's hooks, or a stop and a resume).
 */
export async function tellMail(deps: InboxMail, task: string, sessionId: string, text: string, files: string[]): Promise<boolean> {
  if (!deps.inboxes.knows(sessionId)) return false
  const claimed = deps.mailbox.claim([deps.mailbox.post(task, sessionId, text, files)])
  try {
    await deps.inboxes.tell(sessionId, mailMessage(claimed, 'inbox', deps.language(), deps.note))
  } catch (error) {
    deps.mailbox.settle(claimed, 'dismissed')
    deps.log?.(`chain: ${task}: the inbox of the session ${sessionId} did not take the page's message, which goes the old way: ${(error as Error).message}`)
    return false
  }
  deps.mailbox.settle(claimed, 'delivered', 'inbox')
  deps.log?.(`chain: ${task}: the page's message went into the inbox of the session ${sessionId}`)
  return true
}
