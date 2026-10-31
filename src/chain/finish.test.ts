import { describe, expect, it } from 'vitest'
import { canceled, done, setup, task, todo, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState } from './dispatcher.js'
import type { HandoffSession } from './relay.js'
import { englishOf, notice, textNotice } from '../notice/notice.js'

const kept = notice('cleanup.worktreeKept', { path: 'C:\\abc\\.claude\\worktrees\\abc-1' })

describe('Dispatcher finishing a done task', () => {
  it('cleans up after the current task once it is done, then launches the next', async () => {
    const { dispatcher, launched, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    expect(finished).toEqual([])

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.active[0]?.closing).toBeUndefined()
  })

  it('waits until the session of the done task is not mid-turn', async () => {
    const busy = new Set<string>()
    const { dispatcher, launched, finished } = setup({ busy })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    busy.add('ABC-1')
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active[0]).toMatchObject({ current: null, closing: 'ABC-1' })

    busy.clear()
    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('does not clean up after a done task before the first read of the sessions since the start', async () => {
    const state = { ...emptyChainState(), active: [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'session-1', since: '2026-10-31T07:54:28.000Z' }, paused: false, error: null }] }
    const options: SetupOptions = { state, sessionsRead: false }
    const { dispatcher, launched, finished } = setup(options)
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual([])
    expect(launched).toEqual([])

    options.sessionsRead = true
    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('cleans up at once after a done task whose session ended its turn with a background command still running', async () => {
    const shell = new Set<string>()
    const { dispatcher, launched, finished } = setup({ shell })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    shell.add('ABC-1')
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
  })

  it('waits for the session of a done task that waits for an answer', async () => {
    const waiting = new Set<string>()
    const { dispatcher, finished } = setup({ waiting })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    waiting.add('ABC-1')
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual([])
    expect(dispatcher.state.active[0]?.closing).toBe('ABC-1')
  })

  describe('in the unattended mode', () => {
    const quiet = (lastReplyAt: string): HandoffSession => ({
      sessionId: 'session-1',
      agentId: 'agent-1',
      account: 'global',
      cwd: 'D:/work/abc',
      workdir: 'D:/work/abc/.claude/worktrees/abc-1',
      branch: 'abc-1/task',
      transcript: null,
      lastReplyAt,
      recent: [],
      lastMessage: null,
      checkpoint: null,
    })

    async function closing(lastReplyAt: string) {
      const busy = new Set<string>()
      const context = setup({ busy, unattended: true })
      context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
      context.dispatcher.start('ABC')
      await context.dispatcher.idle()
      busy.add('ABC-1')
      context.handoffs['ABC-1'] = quiet(lastReplyAt)
      context.dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
      await context.dispatcher.idle()
      return context
    }

    it('stops waiting for a done task whose session has been quiet for ten minutes and leaves its cleanup for later', async () => {
      const { dispatcher, launched, finished } = await closing('2026-09-26T11:50:00.000Z')
      expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
      expect(finished).toEqual([])
      expect(dispatcher.state.released).toEqual({ ABC: ['ABC-1'] })
      expect(dispatcher.state.active[0]?.closing).toBeUndefined()
    })

    it('keeps waiting while the session spoke less than ten minutes ago', async () => {
      const { dispatcher, launched } = await closing('2026-09-26T11:51:00.000Z')
      expect(launched).toEqual(['ABC/ABC-1'])
      expect(dispatcher.state.active[0]?.closing).toBe('ABC-1')
    })
  })

  it('does not clean up after a done task that was reopened before its cleanup, and takes it back', async () => {
    const busy = new Set<string>()
    const live: Record<string, string> = {}
    const { dispatcher, launched, finished } = setup({ busy, live })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    busy.add('ABC-1')
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(dispatcher.state.active[0]?.closing).toBe('ABC-1')

    busy.clear()
    live['ABC-1'] = 'session-1'
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual([])
    expect(launched).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active[0]?.closing).toBeUndefined()
    expect(dispatcher.state.active[0]?.current).toMatchObject({ task: 'ABC-1', sessionId: 'session-1' })
  })

  it('leaves a canceled or vanished task alone', async () => {
    const { dispatcher, finished, launched } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', canceled), task('ABC-2'), task('ABC-3')])
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-3')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-3'])
    expect(finished).toEqual([])
  })

  it('cleans up after the last task before the chain ends', async () => {
    const { dispatcher, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(dispatcher.state.active).toEqual([])
  })

  it('keeps the warnings of a cleanup and goes on', async () => {
    const { dispatcher, launched } = setup({ finish: () => ({ warnings: [kept], syncError: null }) })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.leftovers).toEqual({
      ABC: [{ task: 'ABC-1', at: '2026-09-26T12:00:00.000Z', notice: kept }],
    })

    dispatcher.dismiss('ABC', 'ABC-1')
    expect(dispatcher.state.leftovers).toEqual({})
  })

  it('keeps a failed git sync as a warning and goes on to the next task', async () => {
    const { dispatcher, launched, finished } = setup({ finish: () => ({ warnings: [kept], syncError: textNotice('sync: merge it by hand') }) })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, error: null, current: { task: 'ABC-2' } })
    expect(dispatcher.state.leftovers).toEqual({
      ABC: [
        { task: 'ABC-1', at: '2026-09-26T12:00:00.000Z', notice: kept },
        { task: 'ABC-1', at: '2026-09-26T12:00:00.000Z', notice: notice('cleanup.syncFailed', {}, { cause: textNotice('sync: merge it by hand') }) },
      ],
    })
  })

  describe('a sync of main that could not reach the remote', () => {
    const offline = notice('sync.fetch', { remote: 'github' }, { detail: 'fatal: Failed to connect to github.com port 443 after 21096 ms' })
    const later = (clock: { now: Date }, ms: number) => (clock.now = new Date(clock.now.getTime() + ms))

    async function closeAbc1(options: Parameters<typeof setup>[0]) {
      const fixture = setup({ finish: () => ({ warnings: [], syncError: offline }), ...options })
      fixture.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
      fixture.dispatcher.start('ABC')
      await fixture.dispatcher.idle()
      fixture.dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
      await fixture.dispatcher.idle()
      return fixture
    }

    it('is tried again 30 s later while the chain goes on, and leaves no warning once it goes through', async () => {
      const { dispatcher, launched, synced, clock, log } = await closeAbc1({})
      expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
      expect(dispatcher.state.leftovers).toEqual({})
      expect(synced).toEqual([])

      later(clock, 29_000)
      dispatcher.check()
      await dispatcher.idle()
      expect(synced).toEqual([])

      later(clock, 1_000)
      dispatcher.check()
      await dispatcher.idle()
      expect(synced).toEqual(['ABC'])
      expect(dispatcher.state.leftovers).toEqual({})
      expect(log.filter((line) => line.startsWith('git: sync of ABC after ABC-1'))).toHaveLength(2)
    })

    it('becomes a warning after the third failed try, 2 min after the second', async () => {
      const { dispatcher, synced, clock, log } = await closeAbc1({ sync: () => offline })
      later(clock, 30_000)
      dispatcher.check()
      await dispatcher.idle()
      expect(synced).toEqual(['ABC'])
      expect(dispatcher.state.leftovers).toEqual({})

      later(clock, 119_000)
      dispatcher.check()
      await dispatcher.idle()
      expect(synced).toEqual(['ABC'])

      later(clock, 1_000)
      dispatcher.check()
      await dispatcher.idle()
      expect(synced).toEqual(['ABC', 'ABC'])
      expect(dispatcher.state.leftovers).toEqual({
        ABC: [{ task: 'ABC-1', at: clock.now.toISOString(), notice: notice('cleanup.syncFailed', {}, { cause: offline }) }],
      })

      later(clock, 600_000)
      dispatcher.check()
      await dispatcher.idle()
      expect(synced).toEqual(['ABC', 'ABC'])
      expect(log.filter((line) => line.startsWith('git: sync of ABC after ABC-1'))).toHaveLength(3)
    })

    it('becomes a warning at once when the remote refuses on a later try', async () => {
      const refused = notice('sync.push', { remote: 'github', main: 'main' }, { detail: 'remote: Permission denied' })
      const { dispatcher, synced, clock } = await closeAbc1({ sync: () => refused })
      later(clock, 30_000)
      dispatcher.check()
      await dispatcher.idle()
      expect(synced).toEqual(['ABC'])
      expect(dispatcher.state.leftovers).toEqual({
        ABC: [{ task: 'ABC-1', at: clock.now.toISOString(), notice: notice('cleanup.syncFailed', {}, { cause: refused }) }],
      })
    })

    it('is not tried again once the cleanup after the next task syncs main', async () => {
      let syncError: typeof offline | null = offline
      const { dispatcher, synced, clock } = await closeAbc1({ finish: () => ({ warnings: [], syncError }) })
      syncError = null
      dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2', done)])
      await dispatcher.idle()

      later(clock, 30_000)
      dispatcher.check()
      await dispatcher.idle()
      expect(synced).toEqual([])
      expect(dispatcher.state.leftovers).toEqual({})
    })
  })

  it('picks up an unfinished cleanup after a restart', async () => {
    const state = { ...emptyChainState(), active: [{ project: 'ABC', current: null, paused: false, error: null, closing: 'ABC-1' }] }
    const { dispatcher, finished, launched } = setup({ state })
    dispatcher.setTasks('ABC', [task('ABC-1', done), task('ABC-2')])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(launched).toEqual(['ABC/ABC-2'])
  })

  it('does not clean up after a done task the chain was not running', async () => {
    const { dispatcher, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', done)])
    await dispatcher.idle()
    expect(finished).toEqual([])
  })
})

describe('Dispatcher finishing a task it let go of', () => {
  it('cleans up after a task that left the chain once it is done', async () => {
    const { dispatcher, launched, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-2')])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.released('ABC')).toEqual(['ABC-1'])

    dispatcher.setReleased('ABC', [task('ABC-1')])
    await dispatcher.idle()
    expect(finished).toEqual([])

    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
    expect(dispatcher.released('ABC')).toEqual([])
  })

  it('waits until the session of the released task is not mid-turn', async () => {
    const busy = new Set<string>()
    const { dispatcher, finished } = setup({ busy })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-1')
    await dispatcher.idle()

    busy.add('ABC-1')
    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toEqual([])

    busy.clear()
    dispatcher.check()
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
  })

  it('cleans up after a released done task whose session runs only its background command', async () => {
    const shell = new Set<string>()
    const { dispatcher, finished } = setup({ shell })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-1')
    await dispatcher.idle()

    shell.add('ABC-1')
    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
  })

  it('cleans up after the current task of a stopped chain', async () => {
    const { dispatcher, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.stop('ABC')
    expect(dispatcher.released('ABC')).toEqual(['ABC-1'])

    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(finished).toEqual(['ABC/ABC-1'])
  })

  it('forgets a released task that is canceled or gone from Huly', async () => {
    const { dispatcher, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2'), task('ABC-3')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-1')
    await dispatcher.idle()
    dispatcher.skip('ABC', 'ABC-2')
    await dispatcher.idle()
    expect(dispatcher.released('ABC')).toEqual(['ABC-1', 'ABC-2'])

    dispatcher.setReleased('ABC', [task('ABC-1', canceled)])
    await dispatcher.idle()
    expect(dispatcher.released('ABC')).toEqual([])
    expect(dispatcher.state.released).toEqual({})
    expect(finished).toEqual([])
  })

  it('forgets a released task once the chain takes it again', async () => {
    const { dispatcher, launched, finished } = setup()
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()

    dispatcher.setTasks('ABC', [task('ABC-1', todo, 'ABC-2'), task('ABC-2')])
    await dispatcher.idle()
    expect(dispatcher.released('ABC')).toEqual(['ABC-1'])

    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', done)])
    await dispatcher.idle()
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2', 'ABC/ABC-1'])
    expect(finished).toEqual(['ABC/ABC-2'])
    expect(dispatcher.released('ABC')).toEqual([])
  })

  it('keeps the warnings and a failed sync of its cleanup without pausing the chain', async () => {
    const { dispatcher, launched } = setup({ finish: () => ({ warnings: [kept], syncError: textNotice('sync: merge it by hand') }) })
    dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2')])
    dispatcher.start('ABC')
    await dispatcher.idle()
    dispatcher.setTasks('ABC', [task('ABC-2')])
    await dispatcher.idle()

    dispatcher.setReleased('ABC', [task('ABC-1', done)])
    await dispatcher.idle()
    expect(dispatcher.state.active[0]).toMatchObject({ paused: false, current: { task: 'ABC-2' } })
    expect(launched).toEqual(['ABC/ABC-1', 'ABC/ABC-2'])
    expect(dispatcher.state.leftovers).toEqual({
      ABC: [
        { task: 'ABC-1', at: '2026-09-26T12:00:00.000Z', notice: kept },
        { task: 'ABC-1', at: '2026-09-26T12:00:00.000Z', notice: notice('cleanup.syncFailed', {}, { cause: textNotice('sync: merge it by hand') }) },
      ],
    })
  })
})
