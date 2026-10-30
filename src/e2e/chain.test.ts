import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkpoint, commitAndMerge, ends, Gate, parked } from './agent.fixture.js'
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
