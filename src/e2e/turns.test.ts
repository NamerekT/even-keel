import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TURN_HANG_MS, TURN_RESTART_MS } from '../sessions/silence.js'
import { checkpoint, commitAndMerge, ends, Gate, parked, type Turn } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('a turn the chain cannot see the end of', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const stops = () => run.agent.calls.filter((call) => call.kind === 'stop').map((call) => call.sessionId)
  /** A turn that never ends by itself: it has gone quiet. */
  const silent = (): Turn => parked(new Gate(), ends({ say: 'never said' }))
  const silentSince = (sessionId: string) => run.service.sessions.find((view) => view.sessionId === sessionId)?.silentSince ?? null

  it('refuses "New session" on a quiet turn before its threshold and hands the task over once it is confirmed past it', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', silent(), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    const [first] = launches()
    await run.until(() => silentSince(first!.sessionId) !== null, 'the quiet turn seen')
    const since = silentSince(first!.sessionId)!
    const confirmed = { sessionId: first!.sessionId, since }

    expect(await run.refused('chain/restart', { project: PROJECT_ID, task: 'ABC-1' })).toMatchObject({ code: 'chain.silentTurn', params: { task: 'ABC-1', since } })
    expect(await run.refused('chain/restart', { project: PROJECT_ID, task: 'ABC-1', confirmed })).toMatchObject({ code: 'chain.silentTurn' })
    expect(stops()).toEqual([])

    await run.until(() => Date.now() >= Date.parse(since) + TURN_RESTART_MS, 'the threshold passed', { limitMs: TURN_RESTART_MS + 60_000 })
    await run.post('chain/restart', { project: PROJECT_ID, task: 'ABC-1', confirmed })

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    const [, second] = launches()
    expect(launches()).toHaveLength(2)
    expect(stops()[0]).toBe(first!.sessionId)
    expect(second!.cwd).toBe(first!.cwd)
    expect(second!.sessionId).not.toBe(first!.sessionId)
  })

  it('hands a task over without a confirmation once its quiet turn counts as hung', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', silent(), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    const [first] = launches()
    await run.until(() => silentSince(first!.sessionId) !== null, 'the quiet turn seen')
    const since = silentSince(first!.sessionId)!

    await run.until(() => Date.now() >= Date.parse(since) + TURN_HANG_MS, 'the turn hung', { step: 30_000, limitMs: TURN_HANG_MS + 60_000 })
    await run.pass(30_000)
    expect(stops()).toEqual([])
    await run.post('chain/restart', { project: PROJECT_ID, task: 'ABC-1' })

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(launches()).toHaveLength(2)
    expect(stops()[0]).toBe(first!.sessionId)
  })

  it('closes a task marked NO CHANGES: whose turn ended on a background command, stops the session and removes its folder', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', async (turn) => {
      turn.background()
      return { noChanges: 'already done in main' }
    })
    run.agent.script('ABC-2', commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.agent.sessionsOf('ABC-1')[0]?.status === 'shell', 'the turn ended on a background command')
    const [first] = launches()

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(run.board.commentsOf('ABC-1').join('\n')).toContain('already done in main')
    await run.until(() => !existsSync(first!.cwd), 'the worktree of ABC-1 removed')
    expect(stops()).toContain(first!.sessionId)
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
  })

  it('hands over a task marked CHECKPOINT: whose turn ended on a background command, without waiting for the command', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', async (turn) => {
      turn.background()
      return checkpoint('.temp/handoff.md', 'Half of it is done.\n')(turn)
    }, commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.agent.sessionsOf('ABC-1')[0]?.status === 'shell', 'the turn ended on a background command')
    const [first] = launches()

    await run.until(() => launches().length === 2, 'ABC-1 handed over by its checkpoint')
    expect(stops()).toContain(first!.sessionId)
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
  })
})
