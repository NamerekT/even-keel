import { describe, expect, it } from 'vitest'
import { done, fakeMachines, setup, task } from './dispatcher.fixture.js'
import { failedRun, fakeMain } from './maincheck.fixture.js'
import type { HandoffSession } from './relay.js'

const red = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] } as const

const sessionOf = (sessionId: string): HandoffSession => ({
  sessionId,
  agentId: `agent-${sessionId}`,
  account: 'global',
  cwd: '/repo',
  workdir: '/repo',
  branch: 'abc/task',
  transcript: null,
  lastReplyAt: '2026-09-26T11:59:00.000Z',
  recent: [],
  lastMessage: null,
  checkpoint: null,
})

/**
 * ABC runs two lanes without a fix task: ABC-1 on `own`, ABC-2 on `pc`, both at 12:00. ABC-1 is done and pushed;
 * with `wait` zero the lane on `own` goes on to ABC-3 at 12:05 meanwhile. Every session left is mid-turn.
 */
async function twoLanes(capacities: Record<string, number>, wait: number | null) {
  const { ci, deps } = fakeMain(wait)
  ci.fixTask = false
  const { machines, bound, listed } = fakeMachines(capacities, { width: { ABC: 2 } })
  const harness = setup({ main: deps, machines })
  const { dispatcher, busy, handoffs, clock, live } = harness
  dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3'), task('ABC-4')])
  dispatcher.start('ABC')
  await dispatcher.idle()
  busy.add('ABC-2')
  handoffs['ABC-2'] = sessionOf('session-2')
  live['ABC-2'] = 'session-2'
  clock.now = new Date('2026-09-26T12:05:00Z')
  dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2'), task('ABC-3'), task('ABC-4')])
  await dispatcher.idle()
  busy.add('ABC-3')
  handoffs['ABC-3'] = sessionOf('session-3')
  live['ABC-3'] = 'session-3'
  return { ...harness, ci, bound, listed }
}

const redVerdict = async (harness: Awaited<ReturnType<typeof twoLanes>>) => {
  harness.ci.verdict = red
  harness.dispatcher.check()
  await harness.dispatcher.idle()
}

describe('the machine that fixes a red main (BTN-995)', () => {
  it('is the one whose lane waits idle for the verdict: no session is stopped', async () => {
    const harness = await twoLanes({ own: 1, pc: 1 }, null)
    expect(harness.launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    await redVerdict(harness)
    expect(harness.fixes.map((fix) => fix.name)).toEqual(['ABC-FIX'])
    expect(harness.bound['ABC-FIX']).toBe('own')
    expect(harness.stopped).toEqual([])
  })

  it('is a free machine of the pool before any lane is stopped', async () => {
    const harness = await twoLanes({ own: 1, pc: 1, server: 1 }, 0)
    expect(harness.launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-3'])
    await redVerdict(harness)
    expect(harness.bound['ABC-FIX']).toBe('server')
    expect(harness.fixes.map((fix) => fix.name)).toEqual(['ABC-FIX'])
    expect(harness.stopped).toEqual([])
    expect(harness.dispatcher.state.active.find((lane) => lane.current?.task === 'ABC-FIX')?.machine).toBe('server')
  })

  it('with none free, is the one whose lane began its task last: only that session stops', async () => {
    const harness = await twoLanes({ own: 1, pc: 1 }, 0)
    await redVerdict(harness)
    expect(harness.bound['ABC-FIX']).toBe('own')
    expect(harness.stopped).toEqual(['session-3'])
    expect(harness.fixes.map((fix) => fix.name)).toEqual(['ABC-FIX'])
    const pc = harness.dispatcher.state.active.find((lane) => lane.machine === 'pc')
    expect(pc?.current?.task).toBe('ABC-2')
  })

  it('waits while no machine of the pool is on the link, then goes to the first back', async () => {
    const harness = await twoLanes({ own: 1, pc: 1 }, 0)
    delete harness.listed.own
    delete harness.listed.pc
    await redVerdict(harness)
    expect(harness.fixes).toEqual([])
    expect(harness.stopped).toEqual([])
    expect(harness.log.filter((line) => line.includes('the fix waits'))).toHaveLength(1)

    harness.listed.pc = 1
    harness.dispatcher.check()
    await harness.dispatcher.idle()
    expect(harness.bound['ABC-FIX']).toBe('pc')
    expect(harness.stopped).toEqual(['session-2'])
  })

  it('skips a lane on a machine off the link', async () => {
    const harness = await twoLanes({ own: 1, pc: 1 }, 0)
    delete harness.listed.own
    await redVerdict(harness)
    expect(harness.bound['ABC-FIX']).toBe('pc')
    expect(harness.stopped).toEqual(['session-2'])
  })
})
