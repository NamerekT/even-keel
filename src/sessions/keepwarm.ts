import type { ChainState } from '../chain/model.js'
import type { CacheTtl, TurnSpend } from '../state.js'
import { TTL_MS, type CacheWindow } from './transcript.js'
import { isTransientError } from './transient.js'

/** How long before the cache goes cold the ping goes out: the check runs every `KEEP_WARM_TICK_MS`. */
const MARGIN_MS: Record<CacheTtl, number> = { '1h': 5 * 60_000, '5m': 60_000 }
/**
 * The pings a miss costs: a ping reads the context at ~0.1× the input price, a miss writes it again at 2× (an hour's
 * cache) or 1.25× (five minutes').
 */
const BREAK_EVEN: Record<CacheTtl, number> = { '1h': 20, '5m': 12 }
/** A ping that read less of its prompt from the cache missed it. */
const HIT_SHARE = 0.9
export const KEEP_WARM_TICK_MS = 30_000
/** The most hours the `keepWarm` setting takes. */
export const MAX_KEEP_WARM_HOURS = 24
export const KEEP_WARM_PROMPT = 'Reply with the single word ok.'

/** What the check reads anew each time about a session the chain will go on in. */
export interface WarmFacts {
  task: string
  sessionId: string
  /** Mid-turn, being resumed or handed over. */
  busy: boolean
  /** The session or its chain waits on a limit: the ping would hit it too. */
  limited: boolean
  /** The cache its transcript last wrote. */
  cache: CacheWindow | null
}

/** The pings of one stretch of idleness, the stretch named by when the session last answered. */
export interface WarmMemory {
  stretch: string
  pings: number
  /** When the last ping that read the cache went out. */
  warmedAt: string | null
}

export type WarmStep = 'ping' | 'wait'

/** Whether to ping the session now: only a warm cache about to go cold, within the idle ceiling and the break-even. */
export function warmStep(facts: WarmFacts, memory: WarmMemory | undefined, now: Date, maxIdleMs: number): WarmStep {
  const { cache } = facts
  if (facts.busy || facts.limited || cache === null) return 'wait'
  const ttlMs = TTL_MS[cache.ttl]
  const stretch = Date.parse(cache.until) - ttlMs
  const own = memory !== undefined && Date.parse(memory.stretch) === stretch ? memory : undefined
  const warmUntil = Math.max(Date.parse(cache.until), own?.warmedAt == null ? 0 : Date.parse(own.warmedAt) + ttlMs)
  const time = now.getTime()
  if (time >= warmUntil || time - stretch >= maxIdleMs || (own?.pings ?? 0) >= BREAK_EVEN[cache.ttl]) return 'wait'
  return time >= warmUntil - MARGIN_MS[cache.ttl] ? 'ping' : 'wait'
}

export interface WarmTask {
  task: string
  /** The session the chain leads with; `null` — whichever is live for the task (one waiting on its pull request). */
  sessionId: string | null
}

/**
 * The tasks a running chain will go on in a session of: its current one, unless it is starting, being moved or on a
 * limit with a handoff planned, and those whose pull request is open (BTN-205). A paused or halted chain has none;
 * warmStep excludes actual limits, while a temporary model error waiting for a resume remains eligible.
 */
export function warmTasks(state: ChainState): WarmTask[] {
  return state.active.flatMap((chain) => {
    if (chain.paused || chain.error !== null || chain.limitUntil !== undefined) return []
    const { current } = chain
    const leads = current !== null && current.sessionId !== null && current.starting === undefined && (current.limit === undefined || current.limit.then === 'resume')
    const own: WarmTask[] = leads ? [{ task: current.task, sessionId: current.sessionId }] : []
    const reviewed = (state.reviews[chain.project] ?? []).filter((pull) => pull.closed === undefined && pull.task !== current?.task)
    return [...own, ...reviewed.map((pull) => ({ task: pull.task, sessionId: null }))]
  })
}

export interface KeepWarmDeps {
  /** The `keepWarm` setting: the idle hours a session is kept warm for, `0` — off. Read at each check. */
  hours: () => number
  /** The sessions the chain will go on in, by the agents that can ping them. */
  sessions: () => WarmFacts[]
  /** Sends the ping to a fork of the session and gives what its one call read and wrote. */
  ping: (facts: WarmFacts) => Promise<TurnSpend>
  now: () => Date
  log: (line: string) => void
}

/**
 * Keeps the prompt cache of a session that waits warm (BTN-437): a fork of it with no transcript asks for one word
 * shortly before the cache goes cold, and the API reads the same prefix again. A miss or a failure turns it off for
 * that session until a restart, except an overload refusal, which is skipped; what it sent is kept in memory.
 */
export class KeepWarm {
  private readonly memory = new Map<string, WarmMemory>()
  private readonly flying = new Set<string>()
  private readonly off = new Set<string>()

  constructor(private readonly deps: KeepWarmDeps) {}

  /** Wakes the check: the timer sends nothing itself. Resolves once the pings it started are answered. */
  async check(): Promise<void> {
    const hours = this.deps.hours()
    if (hours <= 0) return
    const sessions = this.deps.sessions()
    const present = new Set(sessions.map((each) => each.sessionId))
    for (const id of this.memory.keys()) if (!present.has(id) && !this.flying.has(id)) this.memory.delete(id)
    const now = this.deps.now()
    const pings = sessions
      .filter((each) => !this.off.has(each.sessionId) && !this.flying.has(each.sessionId))
      .filter((each) => warmStep(each, this.memory.get(each.sessionId), now, hours * 60 * 60_000) === 'ping')
      .map((each) => this.ping(each, now))
    await Promise.all(pings)
  }

  /** When the last ping that read the session's cache went out; `null` — none did. */
  warmedAt(sessionId: string): string | null {
    return this.memory.get(sessionId)?.warmedAt ?? null
  }

  private async ping(facts: WarmFacts, now: Date): Promise<void> {
    const { task, sessionId, cache } = facts
    const stretch = new Date(Date.parse(cache!.until) - TTL_MS[cache!.ttl]).toISOString()
    this.flying.add(sessionId)
    try {
      const { tokens } = await this.deps.ping(facts)
      const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
      const read = `read ${tokens.cacheRead} of ${prompt} tokens from the cache, wrote ${tokens.cacheWrite}`
      if (prompt === 0 || tokens.cacheRead / prompt < HIT_SHARE) {
        this.off.add(sessionId)
        this.deps.log(`keepwarm: the ping of ${task} missed the cache of ${sessionId} (${read}): not kept warm until a restart`)
        return
      }
      const before = this.memory.get(sessionId)
      const pings = before?.stretch === stretch ? before.pings + 1 : 1
      this.memory.set(sessionId, { stretch, pings, warmedAt: now.toISOString() })
      this.deps.log(`keepwarm: ${task}: the ping ${pings} kept the cache of ${sessionId} warm (${read})`)
    } catch (error) {
      if (isTransientError((error as Error).message)) {
        this.deps.log(`keepwarm: the ping of ${task} (${sessionId}) skipped: ${(error as Error).message}`)
        return
      }
      this.off.add(sessionId)
      this.deps.log(`keepwarm: the ping of ${task} (${sessionId}) failed: ${(error as Error).message}; not kept warm until a restart`)
    } finally {
      this.flying.delete(sessionId)
    }
  }
}
