import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveChain, ChainState, CurrentTask, DispatcherDeps } from '../chain/model.js'
import type { HandoffSession, LimitedSession } from '../chain/relay.js'
import { notice, type Notice } from '../notice/notice.js'
import { ALONE_TICK_MS, applyFields, fieldsOf } from './moves.js'
import { bench, PROJECT, REPO, tick } from './remote.fixture.js'
import { taskMoves } from './tasks.js'

const NOW = '2026-11-16T10:00:00.000Z'
const RESET = '2026-11-16T11:00:00.000Z'
const HOUR = 60 * 60_000

const session: HandoffSession = {
  sessionId: 'session-1',
  agentId: 'claude',
  account: 'main',
  cwd: REPO,
  workdir: REPO,
  branch: null,
  transcript: null,
  lastReplyAt: null,
  recent: [],
  lastMessage: null,
  checkpoint: null,
}

/**
 * The hub's chain with ABC-1 current over the bench's link, its machine moving without the hub (BTN-1226); the session
 * hit its limit, and the handoff after the reset is `relay`. The hub's first follow has taken the hold.
 */
async function limited(permits?: (project: string, task: string) => boolean) {
  const made = await bench()
  const first = made.boot('first', permits === undefined ? {} : { permits })
  await first.moves.start(ALONE_TICK_MS)
  await first.end.start()
  await tick()
  const current: CurrentTask = { task: 'ABC-1', sessionId: 'session-1', since: NOW }
  const chain: ActiveChain = { project: PROJECT, current, paused: false, error: null }
  const state = { active: [chain], ci: {} } as unknown as ChainState
  const halts: Notice[] = []
  const deps = {
    machine: made.port,
    blocked: () => undefined,
    promptLanguage: () => 'en',
    mainBranch: () => 'main',
    pullRequests: () => false,
    plain: () => false,
    save: () => {},
    log: (line: string) => made.log.push(line),
  } as unknown as DispatcherDeps
  const moves = taskMoves(state, deps, (_chain, error) => void halts.push(error))
  let handed = false
  const hit: LimitedSession = { ...session, limit: { at: NOW, text: 'rate limited' } }
  const relay = vi.fn(async () => {
    handed = true
    made.state.live['ABC-1'] = 'session-2'
    return 'session-2'
  })
  Object.assign(made.local, {
    limited: () => (handed ? undefined : hit),
    handoff: () => ({ ...session, sessionId: handed ? 'session-2' : 'session-1' }),
    locate: async () => session,
    relay,
    limitResetAfter: () => RESET,
    accountAt: () => 'main/john@example.com',
    limitReopenedAt: () => null,
  })
  made.state.live['ABC-1'] = 'session-1'
  await first.runner.publish()
  await tick()
  const followed = moves.follow(chain, current)
  await tick()
  await followed
  const stop = () => {
    first.moves.stop()
    first.end.stop()
    made.hub.stop()
  }
  return { ...made, first, chain, current, moves, halts, relay, stop }
}

describe('a machine without its hub', () => {
  let stop: Array<() => void> = []
  const started = async (permits?: (project: string, task: string) => boolean) => {
    const made = await limited(permits)
    stop.push(made.stop)
    return made
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })

  afterEach(() => {
    for (const each of stop) each()
    stop = []
    vi.useRealTimers()
  })

  it('continues after the limit by itself, and the hub back takes the new session without moving again', async () => {
    const made = await started()
    expect(made.current.limit).toMatchObject({ resetsAt: RESET, then: 'relay', acted: null })
    made.wire.down = true
    made.wire.cut()
    await tick(HOUR + 2 * 60_000)
    expect(made.relay).toHaveBeenCalledTimes(1)
    expect(made.current.sessionId).toBe('session-1')
    made.wire.down = false
    await tick(31_000)
    expect(made.current).toMatchObject({ sessionId: 'session-2', limit: { acted: 'relay' } })
    expect(made.journal).toEqual([expect.objectContaining({ task: 'ABC-1', sessionId: 'session-2', reason: 'relay', previous: 'session-1' })])
    const again = made.moves.follow(made.chain, made.current)
    await tick()
    await again
    expect(made.relay).toHaveBeenCalledTimes(1)
    expect(made.current.sessionId).toBe('session-2')
    expect(made.halts).toEqual([])
  })

  it('goes on from its own state when the hub back asks with the task as it held it before', async () => {
    const made = await started()
    const before = structuredClone(fieldsOf(made.current))
    made.wire.down = true
    made.wire.cut()
    await tick(HOUR + 2 * 60_000)
    made.wire.down = false
    await tick(31_000)
    // The hub that has not taken the machine's events yet: its task is the one it sent last.
    applyFields(made.current, before)
    const again = made.moves.follow(made.chain, made.current)
    await tick()
    await again
    expect(made.relay).toHaveBeenCalledTimes(1)
    expect(made.current.sessionId).toBe('session-2')
  })

  it('makes the move after a restart of its own without the link, from what its database kept', async () => {
    const made = await started()
    made.wire.down = true
    made.wire.cut()
    made.first.moves.stop()
    made.first.end.stop()
    const second = made.boot('second', {})
    stop.push(() => {
      second.moves.stop()
      second.end.stop()
    })
    await second.moves.start(ALONE_TICK_MS)
    await second.end.start()
    await tick(HOUR + 2 * 60_000)
    expect(made.relay).toHaveBeenCalledTimes(1)
    made.wire.down = false
    await tick(31_000)
    expect(made.current.sessionId).toBe('session-2')
  })

  it('brings the pause a move without the hub came to, and makes no move after it', async () => {
    const made = await started()
    made.wire.down = true
    made.wire.cut()
    const refusal = notice('chain.modelUnavailable', { model: 'openai/denied' })
    const modelRefusal = vi.fn((_task: string, sessionId: string) => (sessionId === 'session-1' ? refusal : undefined))
    Object.assign(made.local, { modelRefusal })
    await tick(ALONE_TICK_MS)
    const asked = modelRefusal.mock.calls.length
    expect(asked).toBeGreaterThan(0)
    await tick(HOUR + 2 * 60_000)
    expect(made.relay).not.toHaveBeenCalled()
    expect(modelRefusal.mock.calls.length).toBe(asked)
    made.wire.down = false
    await tick(31_000)
    expect(made.halts).toEqual([refusal])
  })

  it('moves nothing while the link is up: the hub decides', async () => {
    const online = await started()
    await tick(HOUR + 2 * 60_000)
    expect(online.relay).not.toHaveBeenCalled()
  })

  it('forgets a task the hub took from the chain or paused', async () => {
    const taken = await started(() => false)
    expect(taken.held()).toEqual([])
    taken.wire.down = true
    taken.wire.cut()
    await tick(HOUR + 2 * 60_000)
    expect(taken.relay).not.toHaveBeenCalled()
  })
})
