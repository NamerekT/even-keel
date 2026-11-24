import { randomUUID } from 'node:crypto'
import { fail } from '../notice/notice.js'
import { joinCodeOf } from './join-code.js'
import { REQUEST_MS, type Refusal, type RequestAnswer, type RequestAnswerPost, type RequestPost, type RequestState } from './protocol.js'
import type { MachineAbout, MachineRequest } from './view.js'

/** How many requests wait at once: anyone who reaches the door may ask, so the page is never flooded. */
export const MAX_WAITING = 5

export interface JoinRequestsOptions {
  /** The SHA-256 of the hub's certificate for machines. */
  fingerprint(): Promise<string>
  /** A secret to join with once for the machine let in (`HubEnd.admit`). */
  admit(): Promise<{ machine: string; secret: string }>
  /** The refusal of another API version; `undefined` — the hub's own. */
  versionRefusal(api: number): Refusal | undefined
  /** The waiting requests changed: the page shows them anew. */
  changed(): void
  log(line: string): void
  now?(): number
  code?(fingerprint: string, nonce: string): Promise<string>
}

interface Held {
  id: string
  from: string
  about: MachineAbout
  nonce: string
  expiresAt: number
  /** `undefined` while it is computed: the request holds its address already, the page does not show it yet. */
  code?: string
  state: 'waiting' | 'admitting' | 'declined' | RequestState
  timer: ReturnType<typeof setTimeout>
}

/**
 * The machines that asked to join by the hub's address (BTN-1620), in memory only: each waits `REQUEST_MS` for a
 * person to let it in or decline it on the page. The door takes them with no sign-in, so a request is refused `busy`
 * while another from its address waits and `full` past `MAX_WAITING`; refused ones are never shown.
 */
export class JoinRequests {
  private readonly held = new Map<string, Held>()
  private readonly now: () => number
  private readonly code: (fingerprint: string, nonce: string) => Promise<string>

  constructor(private readonly options: JoinRequestsOptions) {
    this.now = options.now ?? Date.now
    this.code = options.code ?? joinCodeOf
  }

  async ask(from: string, post: RequestPost): Promise<RequestAnswer | Refusal> {
    const version = this.options.versionRefusal(post.api)
    if (version !== undefined) return version
    const waiting = [...this.held.values()].filter((each) => each.state === 'waiting')
    if (waiting.some((each) => each.from === from)) return { refused: 'busy' }
    if (waiting.length >= MAX_WAITING) return { refused: 'full' }
    const id = randomUUID()
    const expiresAt = this.now() + REQUEST_MS
    const timer = setTimeout(() => this.expire(id), REQUEST_MS)
    timer.unref?.()
    const held: Held = { id, from, about: post.about, nonce: post.nonce, expiresAt, state: 'waiting', timer }
    this.held.set(id, held)
    try {
      held.code = await this.code(post.public ? '' : await this.options.fingerprint(), post.nonce)
    } catch (error) {
      this.drop(id)
      throw error
    }
    this.options.log(`machines: ${post.about.host} asks to join from ${from}; it waits for a person on the page until ${new Date(expiresAt).toISOString()}`)
    this.options.changed()
    return { request: id, expiresAt }
  }

  /** What became of the request, for the machine that made it: the number it was made with proves which one asks. */
  answer(post: RequestAnswerPost): RequestState | Refusal {
    const held = this.held.get(post.request)
    if (held === undefined || this.now() > held.expiresAt) return { refused: 'expired' }
    if (held.nonce !== post.nonce) return { refused: 'token' }
    if (held.state === 'declined') return { refused: 'declined' }
    return typeof held.state === 'object' ? held.state : { state: 'waiting' }
  }

  /** The requests the page shows: waiting, their code computed. */
  waiting(): MachineRequest[] {
    return [...this.held.values()].flatMap((held) =>
      held.state === 'waiting' && held.code !== undefined ? [{ id: held.id, about: held.about, code: held.code, from: held.from, expiresAt: held.expiresAt }] : [],
    )
  }

  /** "Admit": the machine gets its secret at its next ask; the answer is the machine's id. */
  async admit(id: string): Promise<string> {
    const held = this.waitingOne(id)
    held.state = 'admitting'
    this.options.changed()
    try {
      const { machine, secret } = await this.options.admit()
      held.state = { state: 'admitted', machine, secret }
      this.options.log(`machines: ${held.about.host} (${held.from}) was let in as machine ${machine}`)
      return machine
    } catch (error) {
      held.state = 'waiting'
      this.options.changed()
      throw error
    }
  }

  decline(id: string): void {
    const held = this.waitingOne(id)
    held.state = 'declined'
    this.options.log(`machines: the request of ${held.about.host} (${held.from}) to join was declined`)
    this.options.changed()
  }

  stop(): void {
    for (const id of [...this.held.keys()]) this.drop(id)
  }

  private waitingOne(id: string): Held {
    const held = this.held.get(id)
    if (held === undefined || held.state !== 'waiting' || held.code === undefined || this.now() > held.expiresAt) throw fail('machines.requestGone', {})
    return held
  }

  private expire(id: string): void {
    const held = this.held.get(id)
    if (held === undefined) return
    this.drop(id)
    if (held.state === 'waiting') {
      this.options.log(`machines: the request of ${held.about.host} (${held.from}) to join expired`)
      this.options.changed()
    }
  }

  private drop(id: string): void {
    const held = this.held.get(id)
    if (held === undefined) return
    clearTimeout(held.timer)
    this.held.delete(id)
  }
}
