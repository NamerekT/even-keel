import type { BadgeSettings, BadgeState } from './model.js'

/** No more often than this on a change: the free Cloudflare KV takes 1000 writes a day. */
export const BADGE_MIN_GAP_MS = 2 * 60_000
/** A push without a change, so the Worker sees the service alive. */
export const BADGE_PULSE_MS = 15 * 60_000
const TIMEOUT_MS = 10_000

export interface BadgeTarget {
  project: string
  settings: BadgeSettings
  /** The state to publish now; `undefined` — it cannot be built (the project is gone from the state). */
  state: () => BadgeState | undefined
}

export interface BadgePushDeps {
  /** The projects whose badge is on, from the live config. */
  targets: () => BadgeTarget[]
  secret: () => string | undefined
  post: (url: string, secret: string, body: string) => Promise<{ ok: boolean; status: number }>
  now: () => number
  log: (line: string) => void
}

interface Sent {
  settings: BadgeSettings
  /** The last state built, and the one the Worker has, both without `at`. */
  last: BadgeState | null
  sentKey: string | null
  /** The last attempt, successful or not: a failure waits for the same gap before it is tried again. */
  triedAt: number
  /** The reason of the last failure, logged once. */
  failure: string | null
}

/**
 * Pushes each project's badge state to its Worker (BTN-915): at once on a change unless one went out less than two
 * minutes ago, a pulse every 15 minutes without one. Turning the badge off sends a last state with the chain stopped
 * and nothing after it. A failed push is one log line per reason and a retry by the same schedule; the chain and the
 * page never hear of it.
 */
export class BadgePusher {
  private readonly sent = new Map<string, Sent>()
  private running: Promise<void> | null = null
  private again = false
  private secretWarned = false

  constructor(private readonly deps: BadgePushDeps) {}

  /** Looks at every project: called when the state changes and on a timer for the pulse and the delayed change. */
  tick(): Promise<void> {
    if (this.running !== null) {
      this.again = true
      return this.running
    }
    this.running = this.pass().finally(() => {
      this.running = null
      if (this.again) {
        this.again = false
        void this.tick()
      }
    })
    return this.running
  }

  /** Whether the project's last push went through: without one, nothing a session writes for the badge is shown. */
  pushed(project: string): boolean {
    const sent = this.sent.get(project)
    return sent !== undefined && sent.sentKey !== null && sent.failure === null
  }

  private async pass(): Promise<void> {
    const now = this.deps.now()
    const targets = this.deps.targets()
    const wanted = new Set(targets.map((target) => target.project))
    const pushes: Promise<void>[] = []
    for (const [project, sent] of this.sent) {
      if (wanted.has(project)) continue
      this.sent.delete(project)
      if (sent.last !== null && sent.sentKey !== null) pushes.push(this.push(project, sent, { ...sent.last, chain: { ...sent.last.chain, state: 'stopped' } }, now))
    }
    for (const target of targets) {
      const state = target.state()
      if (state === undefined) continue
      const known = this.sent.get(target.project)
      const moved = known !== undefined && (known.settings.url !== target.settings.url || known.settings.slug !== target.settings.slug)
      const sent: Sent = known === undefined || moved ? { settings: target.settings, last: null, sentKey: null, triedAt: -Infinity, failure: null } : known
      sent.settings = target.settings
      sent.last = state
      this.sent.set(target.project, sent)
      const changed = keyOf(state) !== sent.sentKey
      const gap = now - sent.triedAt
      if ((changed && gap >= BADGE_MIN_GAP_MS) || gap >= BADGE_PULSE_MS) pushes.push(this.push(target.project, sent, state, now))
    }
    await Promise.all(pushes)
  }

  private async push(project: string, sent: Sent, state: BadgeState, now: number): Promise<void> {
    const secret = this.deps.secret()?.trim()
    if (secret === undefined || secret === '') {
      if (!this.secretWarned) this.deps.log('badge: EVEN_KEEL_BADGE_SECRET is not set, no badge is pushed')
      this.secretWarned = true
      return
    }
    this.secretWarned = false
    sent.triedAt = now
    const url = `${sent.settings.url.replace(/\/+$/, '')}/push/${encodeURIComponent(sent.settings.slug)}`
    let failure: string | null = null
    try {
      const answer = await this.deps.post(url, secret, JSON.stringify({ ...state, at: new Date(now).toISOString() }))
      if (!answer.ok) failure = `HTTP ${answer.status}`
    } catch (error) {
      failure = (error as Error).message
    }
    if (failure === null) {
      if (sent.failure !== null) this.deps.log(`badge: ${project} pushes again`)
      sent.failure = null
      sent.sentKey = keyOf(state)
      return
    }
    if (failure !== sent.failure) this.deps.log(`badge: the push of ${project} to ${url} failed: ${failure}; retrying every ${BADGE_MIN_GAP_MS / 60_000} min`)
    sent.failure = failure
  }
}

/** What a push changes: the state without its time. */
function keyOf(state: BadgeState): string {
  const { at: _, ...rest } = state
  return JSON.stringify(rest)
}

/** `fetch` with the secret and a timeout: the service's `post`. */
export async function postBadge(url: string, secret: string, body: string): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  await response.body?.cancel()
  return { ok: response.ok, status: response.status }
}
