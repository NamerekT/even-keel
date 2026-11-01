import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { checkpoint, commitAndMerge, ends, Gate, lingers, parked } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('the chain end to end', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const resumes = () => run.agent.calls.filter((call) => call.kind === 'resume')
  const stops = () => run.agent.calls.filter((call) => call.kind === 'stop').map((call) => call.sessionId)
  const lampOf = (sessionId: string) => run.service.sessions.find((view) => view.sessionId === sessionId)?.lamp

  it('runs tasks in the order of their blocks, cleaning up after each Done', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.board.add('ABC-3', 'ABC-2')
    for (const task of ['ABC-1', 'ABC-2', 'ABC-3']) run.agent.script(task, commitAndMerge(`${task}.txt`))
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-3') === 'Done', 'ABC-3 done')
    await run.until(() => !existsSync(run.agent.sessionsOf('ABC-3')[0]!.cwd) && run.git('branch', '--list', 'abc-*') === '', 'the worktree and branch of ABC-3 removed')

    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2', 'ABC-3'])
    expect(run.git('log', '--format=%s', 'main').split('\n')).toEqual(expect.arrayContaining(['[ABC-1] Work', '[ABC-2] Work', '[ABC-3] Work']))
    expect(run.git('worktree', 'list').split('\n')).toHaveLength(1)
  })

  it('resumes a session that asked once the user answers from the chat, and it finishes the task', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ ask: 'Keep the old format?' }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.agent.sessionsOf('ABC-1')[0]?.ask !== undefined, 'the question asked')
    await run.pass(60_000)
    expect(resumes()).toEqual([])

    const session = run.agent.sessionsOf('ABC-1')[0]!
    await run.post('session/answer', { project: PROJECT_ID, task: 'ABC-1', sessionId: session.sessionId, ask: session.ask!.id, answers: { 'Keep the old format?': 'Yes' }, text: '' })

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(resumes()).toEqual([expect.objectContaining({ sessionId: session.sessionId, prompt: expect.stringContaining('Yes') })])
    expect(launches()).toHaveLength(1)
  })

  it('waits out a limit and resumes the same session after the reset', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ limit: "You've hit your session limit · resets 9:30am (UTC)" }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.log.some((line) => line.includes('ABC-1') && line.includes('limit')), 'the limit seen')
    await run.until(() => Date.now() >= Date.parse('2026-10-01T09:25:00Z'), 'the clock near the reset', { step: 60_000, limitMs: 30 * 60_000 })
    expect(resumes()).toEqual([])

    await run.until(() => resumes().length === 1, 'the session resumed', { step: 10_000, limitMs: 20 * 60_000 })
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse('2026-10-01T09:30:00Z'))
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(resumes()[0]!.sessionId).toBe(launches()[0]!.sessionId)
    expect(launches()).toHaveLength(1)
  })

  // Three hours of the service's clock, a minute a step: ~45 s alone, past a minute next to the rest of the suite.
  it('hands a task over to a new session after a limit that resets once the session cache is cold', { timeout: 120_000 }, async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ limit: "You've hit your session limit · resets 11:00am (UTC)" }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.log.some((line) => line.includes('ABC-1') && line.includes('limit')), 'the limit seen')
    const [first] = launches()

    await run.until(() => launches().length === 2, 'a new session launched', { step: 60_000, limitMs: 3 * 60 * 60_000 })
    expect(Date.now()).toBeGreaterThanOrEqual(Date.parse('2026-10-01T11:00:00Z'))
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    const second = launches()[1]!
    expect(resumes()).toEqual([])
    expect(second.cwd).toBe(first!.cwd)
    expect(second.sessionId).not.toBe(first!.sessionId)
    expect(second.prompt).toContain('session limit')
    expect(stops()).toContain(first!.sessionId)
    expect(run.service.launches).toEqual(expect.arrayContaining([expect.objectContaining({ task: 'ABC-1', reason: 'relay', cause: 'limit', previous: first!.sessionId })]))
  })

  it('closes a task merged while the service was down and goes on to the next one', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge('ABC-1.txt')))
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    const session = launches()[0]!

    await run.restart(async () => {
      gate.open()
      await gate.passed
      await run.agent.settled()
      expect(run.git('log', '--format=%s', 'main')).toContain('[ABC-1] Work')
      expect(run.board.status('ABC-1')).not.toBe('Done')
    })

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.until(() => !existsSync(session.cwd) && !run.git('branch', '--list', 'abc-1*').includes('abc-1'), 'the worktree and branch of ABC-1 removed')
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2'])
    expect(resumes()).toEqual([])
  })

  it('hands a task over to a new session in the same folder on a checkpoint, pointing it at the note', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', checkpoint('.temp/handoff.md', 'Half of it is done.\n'), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    const [first, second] = launches()
    expect(launches()).toHaveLength(2)
    expect(second!.cwd).toBe(first!.cwd)
    expect(second!.sessionId).not.toBe(first!.sessionId)
    expect(second!.prompt).toContain('handoff.md')
    expect(run.agent.calls.filter((call) => call.kind === 'stop').map((call) => call.sessionId)).toContain(first!.sessionId)
  })

  it('hands over past a session that failed before its first answer to what the one before it left', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', checkpoint('.temp/handoff.md', 'Half of it is done.\n'), ends({ fail: 'Invalid API key' }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    const failed = () => run.agent.sessionsOf('ABC-1')[1]
    await run.until(() => failed()?.state === 'done', 'the second session failed')
    await run.until(() => run.service.sessions.some((view) => view.sessionId === failed()!.sessionId), 'the failed session seen')

    await run.post('chain/restart', { project: PROJECT_ID, task: 'ABC-1' })

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    const [, second, third] = launches()
    expect(launches()).toHaveLength(3)
    expect(run.agent.calls.filter((call) => call.kind === 'stop').at(-1)?.sessionId).toBe(second!.sessionId)
    expect(third!.cwd).toBe(second!.cwd)
    expect(third!.prompt).toContain('handoff.md')
    expect(third!.prompt).toContain('Invalid API key')
  })

  it('keeps its chain through a restart and leaves the working session alone', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge('ABC-1.txt')))
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')

    await run.restart()
    await run.pass(60_000)
    expect(run.agent.calls.map((call) => call.kind)).toEqual(['launch'])

    gate.open()
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2'])
    expect(resumes()).toEqual([])
  })

  it('stops the session of a task done before the first read of the sessions after a restart, then removes its folder', async () => {
    run.board.add('ABC-1')
    const gate = new Gate()
    run.agent.script('ABC-1', parked(gate, commitAndMerge('ABC-1.txt')))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    const session = launches()[0]!

    const listing = new Gate()
    await run.restart(() => (run.agent.listing = listing))
    gate.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.pass(60_000)
    expect(existsSync(session.cwd)).toBe(true)

    run.agent.listing = null
    listing.open()
    await run.until(() => !existsSync(session.cwd), 'the worktree of ABC-1 removed')
    expect(run.agent.calls.filter((call) => call.kind === 'stop').map((call) => call.sessionId)).toEqual([session.sessionId])
    expect(run.service.dispatcher.state.leftovers).toEqual({})
  })

  it('stops the session of a task done right after a restart only once its turn ends, then removes its folder', async () => {
    run.board.add('ABC-1')
    const restarted = new Gate()
    const checked = new Gate()
    run.agent.script('ABC-1', parked(restarted, lingers(commitAndMerge('ABC-1.txt'), checked)))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    const session = launches()[0]!

    await run.restart()
    restarted.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.pass(60_000)
    expect(stops()).toEqual([])
    expect(existsSync(session.cwd)).toBe(true)

    checked.open()
    await run.until(() => !existsSync(session.cwd), 'the worktree of ABC-1 removed')
    expect(stops()).toEqual([session.sessionId])
    await run.until(() => lampOf(session.sessionId) === 'finished', 'the session of ABC-1 finished')
    expect(run.service.dispatcher.state.leftovers).toEqual({})
  })

  it('stops a session the cleanup after Done found mid-turn in the task folder once its turn ends', async () => {
    run.board.add('ABC-1')
    const merge = new Gate()
    const checked = new Gate()
    run.agent.script('ABC-1', parked(merge, commitAndMerge('ABC-1.txt')))
    run.agent.script('hand', parked(checked, ends({ say: 'checked' })))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().length === 1, 'ABC-1 launched')
    const session = launches()[0]!
    const hand = await run.agent.launch({ key: 'script' } as AccountHome, { name: 'hand', cwd: session.cwd, prompt: 'Check the build.' })

    merge.open()
    await run.until(() => stops().includes(session.sessionId), 'the session of ABC-1 stopped')
    await run.pass(60_000)
    expect(stops()).toEqual([session.sessionId])

    checked.open()
    await run.until(() => stops().includes(hand), 'the session left mid-turn stopped')
    expect(stops()).toEqual([session.sessionId, hand])
  })

  it('closes a task that needed no change with the reason as a comment', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2', 'ABC-1')
    run.agent.script('ABC-1', ends({ noChanges: 'already done in main' }))
    run.agent.script('ABC-2', commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(run.board.commentsOf('ABC-1').join('\n')).toContain('already done in main')
    await run.until(() => run.board.status('ABC-2') === 'Done', 'ABC-2 done')
  })
})
