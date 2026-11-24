import { describe, expect, it } from 'vitest'
import type { LandOutcome } from '../git/landing.js'
import type { ForwardOutcome } from '../git/sync.js'
import { fakeMachines, setup, task } from './dispatcher.fixture.js'
import { emptyChainState, type ChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'

const COMMIT = 'c'.repeat(40)

const handoff = (task: string, sessionId: string): HandoffSession => ({
  sessionId,
  agentId: sessionId,
  account: 'global',
  cwd: 'D:/work/abc',
  workdir: `D:/work/abc/.claude/worktrees/${task.toLowerCase()}`,
  branch: `${task.toLowerCase()}/task`,
  transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z',
  recent: [],
  lastMessage: 'Merged.',
  checkpoint: null,
  pullRequest: null,
})

/** ABC-1 runs on the own machine `pc`, ABC-2 on `server`: both sessions merged and ended their turn. */
const twoLanes = (): ChainState => ({
  ...emptyChainState(),
  active: [
    { project: 'ABC', current: { task: 'ABC-1', sessionId: 's1', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null },
    { project: 'ABC', machine: 'server', current: { task: 'ABC-2', sessionId: 's2', since: '2026-09-26T11:00:00.000Z' }, paused: false, error: null },
  ],
})

/** Each landing waits until the test settles it. */
function lander() {
  const calls: string[] = []
  const open = new Map<string, (outcome: LandOutcome) => void>()
  const land = (_project: string, id: string) => {
    calls.push(id)
    return new Promise<LandOutcome>((resolve) => open.set(id, resolve))
  }
  const settle = (id: string, outcome: LandOutcome) => {
    open.get(id)!(outcome)
    open.delete(id)
  }
  return { land, calls, settle }
}

function pool(offline = new Set<string>()) {
  const landing = lander()
  const forwards: string[] = []
  const forward = async (project: string, commit: string, machine?: string): Promise<ForwardOutcome> => {
    forwards.push(`${project} ${machine} ${commit.slice(0, 7)}`)
    return 'forwarded'
  }
  const { machines } = fakeMachines({ pc: 1, server: 1 }, { width: { ABC: 2 }, held: { 'ABC-1': 'pc', 'ABC-2': 'server' }, offline })
  const context = setup({ state: twoLanes(), live: { 'ABC-1': 's1', 'ABC-2': 's2' }, machines, land: landing.land, forward, landingWaitMs: 0 })
  context.handoffs['ABC-1'] = handoff('ABC-1', 's1')
  context.handoffs['ABC-2'] = handoff('ABC-2', 's2')
  return { ...context, ...landing, forwards, offline }
}

/** The landings settled behind the chain wake it: their pass is over. */
async function settled(context: ReturnType<typeof pool>) {
  await new Promise((resolve) => setTimeout(resolve, 10))
  await context.dispatcher.idle()
}

async function step(context: ReturnType<typeof pool>) {
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
  await context.dispatcher.idle()
}

describe('The landing turn of a project across machines (BTN-1583)', () => {
  it('lands one task of the project at a time: the next waits until the first landed, and the other machines take its main', async () => {
    const context = pool()
    await step(context)
    expect(context.calls).toEqual(['ABC-1'])
    expect(context.log).toContain('chain: ABC-2 waits to land until the landing of ABC-1 is over')

    context.dispatcher.check()
    await context.dispatcher.idle()
    expect(context.calls).toEqual(['ABC-1'])

    context.settle('ABC-1', { state: 'landed', commit: COMMIT })
    await settled(context)
    expect(context.calls).toEqual(['ABC-1', 'ABC-2'])
    expect(context.forwards).toEqual(['ABC server ccccccc'])
    expect(context.launched).toEqual([])
  })

  it('gives the turn on once the landing went back to its session', async () => {
    const context = pool()
    await step(context)
    context.settle('ABC-1', { state: 'returned', remote: 'origin', files: ['docs/notes.md'] })
    await settled(context)

    expect(context.relays).toMatchObject([{ task: 'ABC-1', sessionId: 's1' }])
    expect(context.calls).toEqual(['ABC-1', 'ABC-2'])
    expect(context.forwards).toEqual([])
  })

  it('waits for a machine that went off the link mid-landing and gives the turn to the other tasks meanwhile', async () => {
    const context = pool()
    context.dispatcher.state.active.reverse()
    await step(context)
    expect(context.calls).toEqual(['ABC-2'])

    context.offline.add('server')
    context.dispatcher.check()
    await context.dispatcher.idle()
    expect(context.calls).toEqual(['ABC-2', 'ABC-1'])

    context.settle('ABC-1', { state: 'landed', commit: COMMIT })
    await settled(context)
    expect(context.forwards).toEqual([])
    expect(context.calls).toEqual(['ABC-2', 'ABC-1'])

    context.offline.delete('server')
    context.settle('ABC-2', { state: 'landed', commit: COMMIT })
    await settled(context)
    expect(context.log).toContain('chain: ABC-2 landed in main of the remote')
    expect(context.calls.filter((id) => id === 'ABC-2')).toHaveLength(1)
    expect(context.forwards).toEqual(['ABC pc ccccccc'])
  })

  it('asks nothing of a machine off the link', async () => {
    const context = pool(new Set(['server']))
    await step(context)
    expect(context.calls).toEqual(['ABC-1'])
    context.settle('ABC-1', { state: 'none' })
    await settled(context)
    expect(context.calls).toEqual(['ABC-1'])
  })
})
