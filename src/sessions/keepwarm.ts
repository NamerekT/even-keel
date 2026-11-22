import type { ChainState } from '../chain/model.js'
import type { KeptWarm, TurnSpend } from '../state.js'
import { TTL_MS, type CacheTtl, type CacheWindow } from './transcript.js'
import { isTransientError } from './transient.js'
import type { WarmPing } from './warm-pings.js'

/**
 * How long before the cache goes cold the ping goes out: the check runs every `KEEP_WARM_TICK_MS`. The five-minute
 * cache's 90 s outlast a restart without a build under it, 5–20 s down and 30–52 s more until the facts are read
 * (BTN-1527); a planned stop with a build under it, 74–173 s down, is covered by the ping ahead of it (`ahead`).
 */
const MARGIN_MS: Record<CacheTtl, number> = { '1h': 5 * 60_000, '30m': 5 * 60_000, '5m': 90_000 }
/** After the checks begin, the facts of every session are read well within this (52 s at most measured, BTN-1527). */
const STARTUP_MS = 3 * 60_000
/**
 * The pings a miss costs: a ping reads the context at ~0.1× the input price, a miss writes it again at 2× (an hour's
 * cache) or 1.25× (five minutes', and GPT's half hour).
 */
const BREAK_EVEN: Record<CacheTtl, number> = { '1h': 20, '30m': 12, '5m': 12 }
/** A ping that read less of its prompt from the cache missed it. */
const HIT_SHARE = 0.9
/** Failed pings in a row, none of them an overload, before a session is not kept warm until a restart. */
const MAX_FAILURES = 3
/** The check only reads facts in memory: a short tick finds a session at once after a restart. */
export const KEEP_WARM_TICK_MS = 5_000
/** The most hours the `keepWarm` setting takes. */
export const MAX_KEEP_WARM_HOURS = 24
export const KEEP_WARM_PROMPT = 'Reply with the single word ok.'

/** What the check reads anew each time about a session the chain will go on in. */
export interface WarmFacts {
  task: string
  sessionId: string
  /** Mid-turn. */
  busy: boolean
  /**
   * The turn waits on the result of a tool call, no model request in flight, and its agent's fork reads such a session
   * from the cache (EKR-142): a long build or test run would let the cache go cold under it.
   */
  onTool: boolean
  /**
   * The turn has ended while a background command or agent of the session runs: the chain still counts it busy, but no
   * request is in flight and the cache goes cold until the job's notice comes (BTN-1507).
   */
  ended: boolean
  /** Being resumed or handed over. */
  held: boolean
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

/** `cold` — the cache went cold while the session could still have been pinged. */
export type WarmStep = 'ping' | 'wait' | 'cold'

function readCache(cacheRead: number, prompt: number): boolean {
  return prompt > 0 && cacheRead / prompt >= HIT_SHARE
}

function isHit(ping: WarmPing): boolean {
  return readCache(ping.cacheRead, ping.input + ping.cacheRead + ping.cacheWrite5m + ping.cacheWrite1h)
}

/** A session's transcript file as a ping goes out: whether the service read it late shows here (BTN-1394). */
export interface TranscriptFile {
  size: number
  modifiedAt: string
  /** The last line the service folded from it. */
  lastEntryAt: string | null
}

/** The log line of a ping as it starts: every input of `warmStep`'s decision, to explain a ping that went out early. */
export function pingLine(facts: WarmFacts, memory: WarmMemory | undefined, now: Date, file: TranscriptFile | null): string {
  const { task, sessionId, cache } = facts
  const stretch = Date.parse(cache!.until) - TTL_MS[cache!.ttl]
  const ping = memory !== undefined && Date.parse(memory.stretch) === stretch ? memory.pings + 1 : 1
  const states = `busy ${facts.busy}, onTool ${facts.onTool}, ended ${facts.ended}, held ${facts.held}, limited ${facts.limited}`
  const series = memory === undefined ? 'none' : `stretch ${memory.stretch}, pings ${memory.pings}, warmed ${memory.warmedAt ?? 'never'}`
  const transcript = file === null ? 'unknown' : `${file.size} bytes, modified ${file.modifiedAt}, last entry ${file.lastEntryAt ?? 'none'}`
  return (
    `keepwarm: ${task}: the ping ${ping} of ${sessionId} starts at ${now.toISOString()}: ` +
    `cache ${cache!.ttl} until ${cache!.until} from the request at ${new Date(stretch).toISOString()}; ${states}; ` +
    `series ${series}; transcript ${transcript}`
  )
}

/** When the cache goes cold: a lifetime after the request or after the last ping of the same stretch that read it. */
function warmUntilOf(cache: CacheWindow, memory: WarmMemory | undefined): number {
  const ttlMs = TTL_MS[cache.ttl]
  const own = memory !== undefined && Date.parse(memory.stretch) === Date.parse(cache.until) - ttlMs ? memory : undefined
  return Math.max(Date.parse(cache.until), own?.warmedAt == null ? 0 : Date.parse(own.warmedAt) + ttlMs)
}

/**
 * Whether to ping the session now: only a warm cache about to go cold, within the idle ceiling and the break-even.
 * `aheadMs` — a planned stop of the service: a cache that would go cold within it is pinged now (BTN-1527).
 */
export function warmStep(facts: WarmFacts, memory: WarmMemory | undefined, now: Date, maxIdleMs: number, aheadMs = 0): WarmStep {
  const { cache } = facts
  if ((facts.busy && !facts.onTool && !facts.ended) || facts.held || facts.limited || cache === null) return 'wait'
  const stretch = Date.parse(cache.until) - TTL_MS[cache.ttl]
  const own = memory !== undefined && Date.parse(memory.stretch) === stretch ? memory : undefined
  const warmUntil = warmUntilOf(cache, memory)
  const time = now.getTime()
  if (time - stretch >= maxIdleMs || (own?.pings ?? 0) >= BREAK_EVEN[cache.ttl]) return 'wait'
  if (time >= warmUntil) return 'cold'
  return time >= warmUntil - Math.max(MARGIN_MS[cache.ttl], aheadMs) ? 'ping' : 'wait'
}

export interface WarmTask {
  task: string
  /** The session the chain leads with; `null` — whichever is live for the task (one waiting on its pull request). */
  sessionId: string | null
}

/**
 * The tasks a running chain will go on in a session of: its current one, unless it is starting, being moved or on a
 * limit with a handoff planned, and those whose pull request is open (BTN-205). A paused or halted chain has none;
 * warmStep excludes actual limits, while a temporary model error waiting for a resume remains eligible. A handoff on a
 * limit already made leaves its record behind for `moved` and `recover`: its new session is kept warm (BTN-1507).
 */
export function warmTasks(state: ChainState): WarmTask[] {
  return state.active.flatMap((chain) => {
    if (chain.paused || chain.error !== null || chain.limitUntil !== undefined) return []
    const { current } = chain
    const limit = current?.limit
    const free = limit === undefined || limit.then === 'resume' || limit.acted === 'relay'
    const leads = current !== null && current.sessionId !== null && current.starting === undefined && free
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
  /** A ping kept a cache warm: the page's clock of it moves on (`kept`). */
  onWarm?: () => void
  /** The session's transcript file for the ping's log line; `null` or a failure — unknown. */
  transcript?: (facts: WarmFacts) => Promise<TranscriptFile | null>
  now: () => Date
  log: (line: string) => void
}

/**
 * Keeps the prompt cache of a session that waits warm (BTN-437): a fork of it with no transcript asks for one word
 * shortly before the cache goes cold, and the API reads the same prefix again. A miss turns it off for that session
 * until a restart, and so do `MAX_FAILURES` failures in a row; an overload refusal is skipped. The series is kept in
 * memory and, after a restart, taken again from the pings `warm_pings` keeps (`restore`).
 */
export class KeepWarm {
  private readonly memory = new Map<string, WarmMemory>()
  private readonly flying = new Map<string, Promise<void>>()
  private readonly off = new Set<string>()
  private readonly failures = new Map<string, number>()
  /** The pings kept before this start, by session, oldest first: each session's series is taken from them once its cache is known. */
  private readonly restored = new Map<string, WarmPing[]>()
  /** When the first check of this process ran. */
  private began: number | null = null
  /** When a check of this process first knew each session's cache. */
  private readonly seen = new Map<string, number>()
  /** The stretch of idleness each session's cut series was logged for, once. */
  private readonly cut = new Map<string, number>()

  constructor(private readonly deps: KeepWarmDeps) {}

  /** The pings the hub kept before this start (`records.restore`). */
  restore(pings: WarmPing[]): void {
    for (const ping of [...pings].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
      if (this.memory.has(ping.sessionId)) continue
      this.restored.set(ping.sessionId, [...(this.restored.get(ping.sessionId) ?? []), ping])
    }
  }

  /**
   * The series of the session's current stretch of idleness from the pings kept before this start: those that read the
   * cache count, the cache is warm from the last of them, and a last one that missed keeps the session off.
   */
  private seed({ task, sessionId, cache }: WarmFacts): void {
    const pings = this.restored.get(sessionId)
    if (pings === undefined || cache === null) return
    this.restored.delete(sessionId)
    if (this.memory.has(sessionId)) return
    const stretch = Date.parse(cache.until) - TTL_MS[cache.ttl]
    const own = pings.filter((ping) => Date.parse(ping.at) >= stretch)
    if (own.length === 0) return
    if (!isHit(own.at(-1)!)) {
      this.off.add(sessionId)
      this.deps.log(`keepwarm: ${task}: the last ping before the restart missed the cache of ${sessionId}: not kept warm until a restart`)
      return
    }
    const hits = own.filter(isHit)
    this.memory.set(sessionId, { stretch: new Date(stretch).toISOString(), pings: hits.length, warmedAt: hits.at(-1)!.at })
    this.deps.log(`keepwarm: ${task}: ${hits.length} pings of ${sessionId} before the restart restored, the last at ${hits.at(-1)!.at}`)
  }

  /**
   * Wakes the check: the timer sends nothing itself. Resolves once the pings it started are answered and gives their
   * count. `aheadMs` — see `ahead`.
   */
  async check(aheadMs = 0): Promise<number> {
    const hours = this.deps.hours()
    if (hours <= 0) return 0
    const sessions = this.deps.sessions()
    for (const each of sessions) this.seed(each)
    const present = new Set(sessions.map((each) => each.sessionId))
    for (const id of this.memory.keys()) if (!present.has(id) && !this.flying.has(id)) this.memory.delete(id)
    for (const map of [this.seen, this.cut]) for (const id of map.keys()) if (!present.has(id)) map.delete(id)
    const now = this.deps.now()
    this.began ??= now.getTime()
    for (const each of sessions) if (each.cache !== null && !this.seen.has(each.sessionId)) this.seen.set(each.sessionId, now.getTime())
    const pings: Promise<void>[] = []
    for (const each of sessions) {
      const { sessionId } = each
      if (this.off.has(sessionId) || this.flying.has(sessionId)) continue
      const step = warmStep(each, this.memory.get(sessionId), now, hours * 60 * 60_000, aheadMs)
      if (step === 'cold') this.reportCut(each)
      if (step !== 'ping') continue
      const ping = this.ping(each, now).finally(() => this.flying.delete(sessionId))
      this.flying.set(sessionId, ping)
      pings.push(ping)
    }
    await Promise.all(pings)
    return pings.length
  }

  /**
   * A planned stop of the service, `aheadMs` long with the facts read after it (BTN-1527): pings now every session
   * whose cache would go cold within it, and resolves with their count once they and the pings already in flight are
   * answered — the stop would cut a ping and lose its record, which the next start takes the series from.
   */
  async ahead(aheadMs: number): Promise<number> {
    const flying = [...this.flying.values()]
    // A window longer than the shortest lifetime would ping a cache just written.
    const pinged = await this.check(Math.min(Math.max(aheadMs, 0), TTL_MS['5m'] - KEEP_WARM_TICK_MS))
    await Promise.all(flying)
    return pinged
  }

  /**
   * One line when a session's cache went cold before any check of this process could ping it: the facts came after
   * its ping was due, soon after the checks began — the service was down, or still reading facts, through the margin.
   */
  private reportCut({ task, sessionId, cache }: WarmFacts): void {
    const stretch = Date.parse(cache!.until) - TTL_MS[cache!.ttl]
    const seen = this.seen.get(sessionId)
    if (this.cut.get(sessionId) === stretch || seen === undefined || this.began === null) return
    const warmUntil = warmUntilOf(cache!, this.memory.get(sessionId))
    const due = warmUntil - MARGIN_MS[cache!.ttl]
    if (seen < due || seen - this.began > STARTUP_MS) return
    this.cut.set(sessionId, stretch)
    const iso = (time: number) => new Date(time).toISOString()
    this.deps.log(
      `keepwarm: ${task}: the cache of ${sessionId} went cold at ${iso(warmUntil)} unpinged: its ping was due from ${iso(due)}, ` +
        `and the first check that knew the session came at ${iso(seen)}, the checks having begun at ${iso(this.began)}: the series ends`,
    )
  }

  /** When the last ping that read the session's cache went out; `null` — none did. */
  warmedAt(sessionId: string): string | null {
    return this.memory.get(sessionId)?.warmedAt ?? null
  }

  /** The pings of the stretch of idleness `cache` names, for the page; `null` — none, or only those of an earlier one. */
  kept(sessionId: string, cache: CacheWindow | null): KeptWarm | null {
    const memory = this.memory.get(sessionId)
    if (memory?.warmedAt == null || cache === null) return null
    if (Date.parse(memory.stretch) !== Date.parse(cache.until) - TTL_MS[cache.ttl]) return null
    return { at: memory.warmedAt, pings: memory.pings }
  }

  private async ping(facts: WarmFacts, now: Date): Promise<void> {
    const { task, sessionId, cache } = facts
    const stretch = new Date(Date.parse(cache!.until) - TTL_MS[cache!.ttl]).toISOString()
    try {
      const file = await (this.deps.transcript?.(facts) ?? Promise.resolve(null)).catch(() => null)
      this.deps.log(pingLine(facts, this.memory.get(sessionId), now, file))
      const { tokens } = await this.deps.ping(facts)
      const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
      const read = `read ${tokens.cacheRead} of ${prompt} tokens from the cache, wrote ${tokens.cacheWrite}`
      this.failures.delete(sessionId)
      if (!readCache(tokens.cacheRead, prompt)) {
        this.off.add(sessionId)
        this.deps.log(`keepwarm: the ping of ${task} missed the cache of ${sessionId} (${read}): not kept warm until a restart`)
        return
      }
      const before = this.memory.get(sessionId)
      const pings = before?.stretch === stretch ? before.pings + 1 : 1
      this.memory.set(sessionId, { stretch, pings, warmedAt: now.toISOString() })
      this.deps.log(`keepwarm: ${task}: the ping ${pings} kept the cache of ${sessionId} warm (${read})`)
      this.deps.onWarm?.()
    } catch (error) {
      if (isTransientError((error as Error).message)) {
        this.deps.log(`keepwarm: the ping of ${task} (${sessionId}) skipped: ${(error as Error).message}`)
        return
      }
      const failures = (this.failures.get(sessionId) ?? 0) + 1
      this.failures.set(sessionId, failures)
      const next = failures < MAX_FAILURES ? `tried again (${failures} of ${MAX_FAILURES})` : 'not kept warm until a restart'
      if (failures >= MAX_FAILURES) this.off.add(sessionId)
      this.deps.log(`keepwarm: the ping of ${task} (${sessionId}) failed: ${(error as Error).message}; ${next}`)
    }
  }
}
