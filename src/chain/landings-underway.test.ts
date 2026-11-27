import { describe, expect, it } from 'vitest'
import type { LandOutcome } from '../git/landing.js'
import { notice } from '../notice/notice.js'
import { done, setup, task } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
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

const runningState = (): ChainState => ({
  ...emptyChainState(),
  active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 's1', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null }],
})

/** Each landing waits until the test settles it. */
function held() {
  let open: ((outcome: LandOutcome) => void) | undefined
  const land = () => new Promise<LandOutcome>((resolve) => (open = resolve))
  return { land, settle: (outcome: LandOutcome) => open!(outcome) }
}

function context(land: (project: string, task: string) => Promise<LandOutcome>, landingWaitMs?: number) {
  const made = setup({ state: runningState(), live: { 'ABC-1': 's1' }, land, ...(landingWaitMs !== undefined && { landingWaitMs }) })
  made.handoffs['ABC-1'] = handoff('s1')
  return made
}

async function step(made: ReturnType<typeof setup>, tasks = [task('ABC-1'), task('ABC-2')]) {
  made.dispatcher.setTasks('ABC', tasks)
  await made.dispatcher.idle()
}

async function settled(made: ReturnType<typeof setup>) {
  await new Promise((resolve) => setTimeout(resolve, 10))
  await made.dispatcher.idle()
}

describe('The landing the page sees under way (BTN-1779)', () => {
  it('is under way while it goes on behind the chain, and once landed until the task leaves the chain', async () => {
    const landing = held()
    const made = context(landing.land, 0)
    await step(made)
    expect(made.dispatcher.landingFacts()).toEqual({ ABC: [{ task: 'ABC-1', underway: true }] })

    landing.settle({ state: 'landed' })
    await settled(made)
    expect(made.dispatcher.state.landings.ABC).toBeUndefined()
    expect(made.dispatcher.landingFacts()).toEqual({ ABC: [{ task: 'ABC-1', underway: true }] })

    await step(made, [task('ABC-1', done), task('ABC-2')])
    expect(made.dispatcher.landingFacts()).toEqual({})
  })

  it('is under way at once after a quick landing went through', async () => {
    const made = context(async () => ({ state: 'landed' }))
    await step(made)
    expect(made.dispatcher.landingFacts()).toEqual({ ABC: [{ task: 'ABC-1', underway: true }] })
  })

  it('is not under way after a quick landing with nothing to land', async () => {
    const made = context(async () => ({ state: 'none' }))
    await step(made)
    expect(made.dispatcher.landingFacts()).toEqual({})
  })

  it('is not under way once the landing went back to its session', async () => {
    const made = context(async () => ({ state: 'returned', remote: 'origin', files: ['docs/notes.md'] }))
    await step(made)
    expect(made.relays).toHaveLength(1)
    expect(made.dispatcher.landingFacts()).toEqual({ ABC: [{ task: 'ABC-1', resolving: true }] })
  })

  it('is under way while it waits to try the remote again', async () => {
    const network: LandOutcome = { state: 'failed', transient: 'network', failure: notice('sync.fetch', { remote: 'origin' }, { detail: 'Could not resolve host' }) }
    const made = context(async () => network)
    await step(made)
    expect(made.dispatcher.landingFacts()).toEqual({ ABC: [{ task: 'ABC-1', underway: true }] })
  })

  it('is not under way for a later session of the task', async () => {
    const made = context(async () => ({ state: 'landed' }))
    await step(made)
    made.dispatcher.state.active[0]!.current!.sessionId = 's2'
    expect(made.dispatcher.landingFacts()).toEqual({})
  })
})
