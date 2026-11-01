import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, ends, Gate, parked, type Turn } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'
import { BACKLOG, TODO } from './tracker.fixture.js'

describe('a task that leaves the chain and comes back', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const stops = () => run.agent.calls.filter((call) => call.kind === 'stop').map((call) => call.sessionId)

  /** A turn that commits half of the work, files a blocker of its task on the board and ends its turn. */
  const blockedBy = (blocker: string): Turn => async ({ task, cwd, git }) => {
    await writeFile(join(cwd, 'half.txt'), 'half\n')
    await git('add', 'half.txt')
    await git('commit', '-m', `[${task}] Half`)
    run.board.add(blocker)
    run.board.tasks.get(task)!.blockedBy = [blocker]
    return { say: `Half of it is committed; ${task} goes on once ${blocker} is done.` }
  }

  it.each([false, true])('hands a task back from its blocker to a new session on the same branch (restart in between: %s)', async (restart) => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', blockedBy('ABC-2'), commitAndMerge('ABC-1.txt'))
    run.agent.script('ABC-2', commitAndMerge('ABC-2.txt'))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().some((call) => call.task === 'ABC-2'), 'the blocker launched')
    const [first] = launches()
    if (restart) await run.restart()

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    const [, blocker, second] = launches()
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2', 'ABC-1'])
    expect(blocker!.cwd).not.toBe(first!.cwd)
    expect(second!.cwd).toBe(first!.cwd)
    expect(second!.sessionId).not.toBe(first!.sessionId)
    expect(second!.prompt).toContain('Half of it is committed')
    expect(second!.prompt).toContain('ABC-2')
    expect(stops()).toContain(first!.sessionId)
    expect(run.git('log', '--format=%s', 'main').split('\n')).toEqual(expect.arrayContaining(['[ABC-1] Half', '[ABC-1] Work', '[ABC-2] Work']))
    expect(run.service.launches).toEqual(expect.arrayContaining([expect.objectContaining({ task: 'ABC-1', reason: 'relay', cause: 'unblocked', previous: first!.sessionId })]))
  })

  /** A turn that asks in a comment on the board, moves its task to Backlog and ends in plain text, as unattended mode says. */
  const askedInComment: Turn = async ({ task }) => {
    run.board.reply(task, 'Which of the two layouts?')
    run.board.tasks.get(task)!.status = BACKLOG
    return { say: 'The question is in the comments: which of the two layouts?' }
  }

  it.each([false, true])('hands a task back from Backlog after a question in a comment to a new session (the old one waiting with no question: %s)', async (waiting) => {
    run.board.add('ABC-1')
    run.board.add('ABC-2')
    const gate = new Gate()
    run.agent.script('ABC-1', askedInComment, commitAndMerge('ABC-1.txt'))
    run.agent.script('ABC-2', parked(gate, commitAndMerge('ABC-2.txt')))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => launches().some((call) => call.task === 'ABC-2'), 'ABC-1 left the chain and ABC-2 launched')
    const [first] = launches()
    if (waiting) run.agent.waits(first!.sessionId)

    run.board.reply('ABC-1', 'The second one.')
    run.board.tasks.get('ABC-1')!.status = TODO
    await run.pass(60_000)
    expect(stops()).toEqual([])
    gate.open()

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    const [, , second] = launches()
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2', 'ABC-1'])
    expect(second!.cwd).toBe(first!.cwd)
    expect(second!.prompt).toContain('comments')
    expect(second!.prompt).toContain('which of the two layouts')
    expect(stops()).toContain(first!.sessionId)
    expect(run.service.launches).toEqual(expect.arrayContaining([expect.objectContaining({ task: 'ABC-1', reason: 'relay', cause: 'returned', previous: first!.sessionId })]))
  })

  it('hands a skipped task back to a new session in the same folder after Unskip', async () => {
    run.board.add('ABC-1')
    run.board.add('ABC-2')
    const gate = new Gate()
    run.agent.script('ABC-1', ends({ say: 'Stuck on the old format; the plan is in the last message.' }), commitAndMerge('ABC-1.txt'))
    run.agent.script('ABC-2', parked(gate, commitAndMerge('ABC-2.txt')))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.agent.sessionsOf('ABC-1')[0]?.state === 'done', 'the turn of ABC-1 ended')
    const [first] = launches()

    await run.post('chain/skip', { project: PROJECT_ID, task: 'ABC-1' })
    await run.until(() => launches().some((call) => call.task === 'ABC-2'), 'ABC-2 launched')
    await run.post('chain/unskip', { project: PROJECT_ID, task: 'ABC-1' })
    gate.open()

    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    const [, , second] = launches()
    expect(launches().map((call) => call.task)).toEqual(['ABC-1', 'ABC-2', 'ABC-1'])
    expect(second!.cwd).toBe(first!.cwd)
    expect(second!.prompt).toContain('Stuck on the old format')
    expect(stops()).toContain(first!.sessionId)
    expect(run.service.launches).toEqual(expect.arrayContaining([expect.objectContaining({ task: 'ABC-1', reason: 'relay', cause: 'unskipped', previous: first!.sessionId })]))
  })
})
