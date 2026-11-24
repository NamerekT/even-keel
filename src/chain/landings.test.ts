import { describe, expect, it } from 'vitest'
import type { LandOutcome } from '../git/landing.js'
import { notice } from '../notice/notice.js'
import { setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { Landing } from './model.js'
import type { HandoffSession } from './relay.js'

const handoff = (sessionId: string): HandoffSession => ({
  sessionId,
  agentId: sessionId.slice(0, 8),
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1',
  branch: 'abc-1/task',
  transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z',
  recent: [],
  lastMessage: 'Merged.',
  checkpoint: null,
  pullRequest: null,
})

const runningState = (landings: Landing[] = []): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }],
  ...(landings.length > 0 && { landings: { ABC: landings } }),
})

const conflict: LandOutcome = { state: 'returned', remote: 'origin', files: ['docs/notes.md'] }
const red: LandOutcome = { state: 'returned', remote: 'origin', red: { command: 'npm test', code: 1, output: 'FAIL src/a.test.ts' } }
const network: LandOutcome = { state: 'failed', transient: 'network', failure: notice('sync.fetch', { remote: 'origin' }, { detail: 'Could not resolve host' }) }

/** The landing answers what `outcomes` gives in turn, the last one from then on. */
function lander(...outcomes: LandOutcome[]) {
  const calls: string[] = []
  const land = async (_project: string, id: string) => {
    calls.push(id)
    return outcomes[Math.min(calls.length, outcomes.length) - 1]!
  }
  return { land, calls }
}

async function running(land: SetupOptions['land'], options: SetupOptions = {}, landings: Landing[] = []) {
  const context = setup({ state: runningState(landings), live: { 'ABC-1': 'old-session' }, land, ...options })
  context.handoffs['ABC-1'] = handoff('old-session')
  await step(context)
  return context
}

async function step(context: ReturnType<typeof setup>) {
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
  await context.dispatcher.idle()
}

const landingIn = (state: ChainState) => state.landings.ABC?.[0]

describe('Landing of a session merge', () => {
  it('resumes the warm session with the files of the conflict and keeps the task current', async () => {
    const { dispatcher, relays, journal, launched } = await running(lander(conflict).land)

    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-1', sessionId: 'old-session' }])
    expect(relays[0]?.prompt).toContain('docs/notes.md')
    expect(journal.at(-1)).toMatchObject({ task: 'ABC-1', reason: 'resume', cause: 'landing', previous: 'old-session' })
    expect(landingIn(dispatcher.state)).toEqual({ task: 'ABC-1', rounds: 1, resolving: true })
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, current: { task: 'ABC-1' } })
    expect(launched).toEqual([])
  })

  it('hands the task over to a new session with the red command and its output once the cache is cold', async () => {
    const context = setup({ state: runningState(), live: { 'ABC-1': 'old-session' }, land: lander(red).land })
    context.handoffs['ABC-1'] = handoff('old-session')
    context.clock.now = new Date('2026-09-26T13:00:00Z')
    await step(context)

    expect(context.relays).toMatchObject([{ kind: 'relay', task: 'ABC-1', reason: 'landing' }])
    expect(context.relays[0]?.prompt).toContain('npm test')
    expect(context.relays[0]?.prompt).toContain('FAIL src/a.test.ts')
    expect(context.journal.at(-1)).toMatchObject({ reason: 'relay', cause: 'landing' })
  })

  it('returns the task three times, then pauses on landing.exhausted and tells the session nothing more', async () => {
    const context = await running(lander(conflict).land)
    await step(context)
    await step(context)
    expect(context.relays).toHaveLength(3)
    expect(landingIn(context.dispatcher.state)?.rounds).toBe(3)

    await step(context)
    expect(context.relays).toHaveLength(3)
    expect(context.dispatcher.state.active[0]).toMatchObject({ paused: true, error: { code: 'landing.exhausted' }, current: { task: 'ABC-1' } })
  })

  it('starts the rounds over on a person answer', async () => {
    const context = await running(lander(conflict).land, {}, [{ task: 'ABC-1', rounds: 3, resolving: true }])
    expect(context.dispatcher.state.active[0]).toMatchObject({ paused: true, error: { code: 'landing.exhausted' } })

    context.dispatcher.answer('ABC', 'ABC-1', 'old-session', null, 'Merge it again.')
    await context.dispatcher.idle()
    expect(context.dispatcher.state.active[0]).toMatchObject({ paused: false, error: null })
    expect(landingIn(context.dispatcher.state)?.rounds).toBe(0)
    expect(context.relays.at(-1)).toMatchObject({ kind: 'reply', prompt: 'Merge it again.' })
  })

  it('drops the landing once the merge lands, and reads the tracker for the Done', async () => {
    const { dispatcher, refreshed, relays } = await running(lander({ state: 'landed' }).land, {}, [{ task: 'ABC-1', rounds: 2, resolving: true }])

    expect(dispatcher.state.landings.ABC).toBeUndefined()
    expect(refreshed).toContain('ABC')
    expect(relays).toEqual([])
  })

  it('tries an unreachable remote again after 30 s, then 2 min, then waits for it, telling the session nothing', async () => {
    const { land, calls } = lander(network)
    const context = await running(land)
    expect(landingIn(context.dispatcher.state)).toEqual({ task: 'ABC-1', rounds: 0, failures: 1, retryAt: '2026-09-26T12:00:30.000Z' })

    await step(context)
    expect(calls).toHaveLength(1)

    context.clock.now = new Date('2026-09-26T12:00:31Z')
    await step(context)
    expect(landingIn(context.dispatcher.state)).toMatchObject({ failures: 2, retryAt: '2026-09-26T12:02:31.000Z' })
    expect(landingIn(context.dispatcher.state)?.waitingRemote).toBeUndefined()

    context.clock.now = new Date('2026-09-26T12:03:00Z')
    await step(context)
    expect(landingIn(context.dispatcher.state)).toMatchObject({ failures: 3, waitingRemote: true, retryAt: '2026-09-26T12:13:00.000Z' })
    expect(context.relays).toEqual([])
    expect(context.dispatcher.state.active[0]).toMatchObject({ paused: false, current: { task: 'ABC-1' } })
  })

  it('clears the wait for the remote once the landing has nothing more to do', async () => {
    const context = await running(lander({ state: 'none' }).land, {}, [{ task: 'ABC-1', rounds: 0, failures: 3, waitingRemote: true, retryAt: '2026-09-26T11:59:00.000Z' }])

    expect(landingIn(context.dispatcher.state)).toEqual({ task: 'ABC-1', rounds: 0 })
  })

  it('pauses on a refusal of the remote with its git text, without a round', async () => {
    const refusal: LandOutcome = { state: 'failed', transient: null, failure: notice('sync.push', { remote: 'origin', main: 'main' }, { detail: 'pre-receive hook declined' }) }
    const { dispatcher, relays } = await running(lander(refusal).land)

    expect(relays).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: { code: 'landing.refused', cause: { code: 'sync.push', detail: 'pre-receive hook declined' } } })
    expect(landingIn(dispatcher.state)?.rounds).toBe(0)
  })

  it('does not land mid-turn', async () => {
    const { calls, land } = lander(conflict)
    const { relays } = await running(land, { busy: new Set(['ABC-1']) })

    expect(calls).toEqual([])
    expect(relays).toEqual([])
  })

  it('waits with the message while the account is out of limit, and delivers it once the limit is back', async () => {
    const options = { limitReset: '2026-09-26T13:00:00.000Z' as string | null }
    const context = setup({ state: runningState(), live: { 'ABC-1': 'old-session' }, land: lander(conflict).land, limitResetOf: () => options.limitReset })
    context.handoffs['ABC-1'] = handoff('old-session')
    await step(context)
    expect(context.relays).toEqual([])
    expect(landingIn(context.dispatcher.state)?.message).toContain('docs/notes.md')

    options.limitReset = null
    await step(context)
    expect(context.relays).toMatchObject([{ kind: 'reply', task: 'ABC-1' }])
    expect(landingIn(context.dispatcher.state)).toMatchObject({ rounds: 1 })
    expect(landingIn(context.dispatcher.state)?.message).toBeUndefined()
  })

  it('drops the landing of a task that left the chain', async () => {
    const context = await running(lander(conflict).land)
    context.dispatcher.setTasks('ABC', [task('ABC-2')])
    await context.dispatcher.idle()

    expect(context.dispatcher.state.landings.ABC).toBeUndefined()
  })
})
