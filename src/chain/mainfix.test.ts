import { describe, expect, it } from 'vitest'
import { done, setup, task } from './dispatcher.fixture.js'
import { afterDone, failedRun, fakeMain } from './maincheck.fixture.js'
import type { HandoffSession } from './relay.js'

const red = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] } as const

const sessionOf = (sessionId: string, lastReplyAt: string): HandoffSession => ({
  sessionId,
  agentId: `agent-${sessionId}`,
  account: 'global',
  cwd: '/repo/.claude/worktrees/abc-2',
  workdir: '/repo/.claude/worktrees/abc-2',
  branch: 'abc-2/task',
  transcript: null,
  lastReplyAt,
  recent: [],
  lastMessage: null,
  checkpoint: null,
})

/** ABC-1 is done and pushed; without a fix task the red verdict on it is a session's to fix. */
const withoutTask = (wait: number | null = null) =>
  afterDone(wait, (ci) => {
    ci.fixTask = false
  })

/** ABC-2 was launched before the red verdict came and is mid-turn in `session-2`. */
async function working(wait: number | null = 0) {
  const harness = await withoutTask(wait)
  const { dispatcher, busy, handoffs, ci } = harness
  busy.add('ABC-2')
  handoffs['ABC-2'] = sessionOf('session-2', '2026-09-26T11:59:00.000Z')
  ci.verdict = red
  dispatcher.check()
  await dispatcher.idle()
  return harness
}

describe('Dispatcher and a red main without a fix task', () => {
  it('starts a session without a task and checks its push', async () => {
    const { dispatcher, launched, fixes, finished, clock, ci } = await withoutTask()
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(ci.created).toEqual([])
    expect(fixes).toEqual([{ project: 'ABC', name: 'ABC-FIX', report: 'fix main: log' }])
    expect(dispatcher.state.ci.ABC?.fix).toEqual({ task: 'ABC-FIX', at: '2026-09-26T12:00:00.000Z', commit: 'bbbbbbbbbb', report: 'fix main: log' })
    expect(dispatcher.state.active[0]?.current).toMatchObject({ task: 'ABC-FIX', sessionId: 'session-2' })
    expect(dispatcher.held('ABC')).toEqual([])

    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-FIX')

    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1', 'ABC/ABC-FIX'])
    expect(dispatcher.state.ci.ABC?.check).toEqual({ commit: 'cccccccccc', at: clock.now.toISOString(), tasks: ['ABC-FIX'] })
    expect(dispatcher.state.ci.ABC?.fix?.report).toBeUndefined()
    expect(dispatcher.state.active[0]?.current).toBeNull()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-FIX'])

    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC).toEqual({ green: 'cccccccccc' })
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-FIX', 'ABC/ABC-2'])
    expect(dispatcher.state.released).toEqual({})
  })

  it('does not touch a fix session that is mid-turn or has not merged', async () => {
    const { dispatcher, busy, finished, ci } = await withoutTask()
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    ci.merged.add('ABC-FIX')
    busy.add('ABC-FIX')
    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-FIX')
  })

  it('stops the chain when the push of the fix is red, without another fix', async () => {
    const { dispatcher, fixes, ci } = await withoutTask()
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    dispatcher.check()
    await dispatcher.idle()

    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(fixes).toHaveLength(1)
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, current: null, error: { code: 'ci.fixFailed', params: { task: 'ABC-FIX', commit: 'ccccccc' } } })
    expect(dispatcher.state.ci.ABC?.fix).toBeUndefined()
  })

  it('lets a red verdict that comes while the fix session works add nothing', async () => {
    const { dispatcher, fixes, finished, log, ci } = await withoutTask(0)
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2', done), task('ABC-3')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(fixes).toHaveLength(1)

    dispatcher.state.ci.ABC!.check = { commit: 'eeeeeeeeee', at: '2026-09-26T12:00:00.000Z', tasks: ['ABC-7'] }
    dispatcher.check()
    await dispatcher.idle()
    expect(fixes).toHaveLength(1)
    expect(log).toContain('ci: ABC: eeeeeee is red; the session ABC-FIX is already fixing main')
  })

  it('gives a project whose chain has ended a chain for the fix alone', async () => {
    const { ci, deps } = fakeMain()
    ci.fixTask = false
    const { dispatcher, launched } = setup({ main: deps })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])

    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active).toMatchObject([{ project: 'ABC', fixOnly: true, current: { task: 'ABC-FIX' } }])

    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-FIX'])
  })

  it('drops the fix on "Skip" and goes on with the chain', async () => {
    const { dispatcher, launched, busy, ci } = await withoutTask()
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    busy.add('ABC-FIX')
    expect(() => dispatcher.skip('ABC', 'ABC-FIX')).toThrow()
    busy.delete('ABC-FIX')

    dispatcher.skip('ABC', 'ABC-FIX')
    await dispatcher.idle()
    expect(dispatcher.state.ci.ABC?.fix).toBeUndefined()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-FIX', 'ABC/ABC-2'])
  })
})

describe('Dispatcher and the session a red main interrupts', () => {
  it('stops the working session of the current task and starts the fix', async () => {
    const { dispatcher, launched, stopped, journal } = await working()
    expect(stopped).toEqual(['session-2'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-FIX'])
    expect(dispatcher.state.active[0]).toMatchObject({
      current: { task: 'ABC-FIX', sessionId: 'session-3' },
      interrupted: { task: 'ABC-2', sessionId: 'session-2', at: '2026-09-26T12:00:00.000Z', commit: 'bbbbbbbbbb' },
    })
    expect(dispatcher.state.released).toEqual({})
    expect(journal.at(-1)).toMatchObject({ task: 'ABC-FIX', sessionId: 'session-3' })
  })

  it('resumes it with what happened to main while the cache is warm', async () => {
    const { dispatcher, busy, relays, journal, clock, ci } = await working()
    busy.delete('ABC-2')
    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    clock.now = new Date('2026-09-26T12:20:00Z')
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toHaveLength(1)
    expect(relays[0]).toMatchObject({ kind: 'reply', task: 'ABC-2', sessionId: 'session-2' })
    expect(relays[0]!.prompt).toContain('bbbbbbb')
    expect(relays[0]!.prompt).toContain('ccccccc')
    expect(journal.at(-1)).toMatchObject({ task: 'ABC-2', sessionId: 'session-2', reason: 'resume', previous: 'session-2' })
    expect(dispatcher.state.active[0]?.interrupted).toBeUndefined()
    expect(dispatcher.state.active[0]?.current).toEqual({ task: 'ABC-2', sessionId: 'session-2', since: '2026-09-26T12:00:00.000Z', resumedAt: '2026-09-26T12:20:00.000Z' })
  })

  it('hands it over to a new session with the same message once the cache is cold', async () => {
    const { dispatcher, busy, relays, journal, clock, ci } = await working()
    busy.delete('ABC-2')
    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    clock.now = new Date('2026-09-26T13:00:00Z')
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toHaveLength(1)
    expect(relays[0]).toMatchObject({ kind: 'relay', task: 'ABC-2', sessionId: 'session-2', reason: 'mainFixed' })
    expect(relays[0]!.prompt).toContain('остановил Even Keel')
    expect(relays[0]!.prompt).toContain('bbbbbbb')
    expect(journal.at(-1)).toMatchObject({ task: 'ABC-2', sessionId: 'session-4', reason: 'relay', previous: 'session-2' })
    expect(dispatcher.state.active[0]?.current).toMatchObject({ task: 'ABC-2', sessionId: 'session-4' })
  })

  it('waits for the verdict on the fix before it resumes the session', async () => {
    const harness = await withoutTask(10 * 60_000)
    const { dispatcher, busy, handoffs, relays, clock, ci } = harness
    clock.now = new Date('2026-09-26T12:10:00Z')
    dispatcher.check()
    await dispatcher.idle()
    busy.add('ABC-2')
    handoffs['ABC-2'] = sessionOf('session-2', '2026-09-26T12:10:00.000Z')
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.interrupted?.task).toBe('ABC-2')

    busy.delete('ABC-2')
    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ current: null, interrupted: { task: 'ABC-2', fixed: 'cccccccccc' }, ciWait: { commit: 'cccccccccc' } })
    expect(ci.prepared).toEqual(['ABC/ABC-2'])

    ci.verdict = { state: 'green' }
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-2' }])
  })

  it('leaves it stopped, as the current task of the paused chain, when the push of the fix is red', async () => {
    const harness = await withoutTask(10 * 60_000)
    const { dispatcher, busy, handoffs, relays, clock, ci } = harness
    clock.now = new Date('2026-09-26T12:10:00Z')
    dispatcher.check()
    await dispatcher.idle()
    busy.add('ABC-2')
    handoffs['ABC-2'] = sessionOf('session-2', '2026-09-26T12:10:00.000Z')
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    busy.delete('ABC-2')
    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    dispatcher.check()
    await dispatcher.idle()

    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toEqual([])
    const chain = dispatcher.state.active[0]!
    expect(chain).toMatchObject({ paused: true, error: { code: 'ci.fixFailed' }, current: { task: 'ABC-2', sessionId: 'session-2' } })
    expect(chain.interrupted).toBeUndefined()
  })

  it('leaves a session that is not mid-turn alone and takes it again after the fix', async () => {
    const harness = await withoutTask(0)
    const { dispatcher, stopped, launched, live, relays, ci } = harness
    live['ABC-2'] = 'session-2'
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(stopped).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-FIX' } })
    expect(dispatcher.state.active[0]?.interrupted).toBeUndefined()
    expect(dispatcher.state.released).toEqual({ ABC: ['ABC-2'] })

    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    dispatcher.check()
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.current).toMatchObject({ task: 'ABC-2', sessionId: 'session-2' })
    expect(relays).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-FIX'])
  })

  it('does not stop a session whose branch is already in main', async () => {
    const harness = await withoutTask(0)
    const { dispatcher, busy, handoffs, stopped, fixes, ci } = harness
    busy.add('ABC-2')
    handoffs['ABC-2'] = sessionOf('session-2', '2026-09-26T11:59:00.000Z')
    ci.merged.add('ABC-2')
    ci.verdict = red
    dispatcher.check()
    await dispatcher.idle()
    expect(stopped).toEqual([])
    expect(fixes).toEqual([])
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-2')
    expect(dispatcher.state.ci.ABC?.fix?.report).toBe('fix main: log')
  })

  it('does not resume a task the user skipped while main was being fixed', async () => {
    const { dispatcher, busy, relays, launched, ci } = await working()
    busy.delete('ABC-2')
    dispatcher.skip('ABC', 'ABC-2')
    ci.verdict = { state: 'pending' }
    ci.merged.add('ABC-FIX')
    dispatcher.check()
    await dispatcher.idle()
    expect(relays).toEqual([])
    expect(dispatcher.state.active[0]?.interrupted).toBeUndefined()
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-3')
    expect(dispatcher.state.released).toEqual({ ABC: ['ABC-2'] })
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-FIX', 'ABC/ABC-3'])
  })

  it('keeps the task of the stopped session for the cleanup when the chain is stopped', async () => {
    const { dispatcher } = await working()
    dispatcher.stop('ABC')
    await dispatcher.idle()
    expect(dispatcher.state.active).toEqual([])
    expect(dispatcher.state.released).toEqual({ ABC: ['ABC-2'] })
  })
})
