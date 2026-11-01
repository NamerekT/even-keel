import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, ends } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe("a session's question end to end", { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const resumes = () => run.agent.calls.filter((call) => call.kind === 'resume')

  it('puts the question on the tracker and resumes the same session with the answer of a reply comment', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ ask: 'Keep the old format?' }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)

    await run.until(() => run.board.commentsOf('ABC-1').length === 1, 'the question posted on the board')
    expect(run.board.commentsOf('ABC-1')[0]).toContain('Keep the old format?')
    await run.pass(60_000)
    expect(resumes()).toEqual([])

    run.board.reply('ABC-1', '2')
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    const session = launches()[0]!
    expect(resumes()).toEqual([expect.objectContaining({ sessionId: session.sessionId, prompt: expect.stringContaining('No') })])
    expect(launches()).toHaveLength(1)
  })

  it('keeps a question open through a restart and resumes the same session with the answer from the chat', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ ask: 'Keep the old format?' }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.service.sessions.some((view) => view.ask !== null), 'the question seen')

    await run.restart()
    await run.until(() => run.service.sessions.some((view) => view.ask !== null), 'the question seen after the restart')
    await run.pass(60_000)
    expect(run.agent.calls.map((call) => call.kind)).toEqual(['launch'])

    const session = run.agent.sessionsOf('ABC-1')[0]!
    await run.post('session/answer', { project: PROJECT_ID, task: 'ABC-1', sessionId: session.sessionId, ask: session.ask!.id, answers: { 'Keep the old format?': 'Yes' }, text: '' })
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(resumes()).toEqual([expect.objectContaining({ sessionId: session.sessionId, prompt: expect.stringContaining('Yes') })])
    expect(launches()).toHaveLength(1)
  })
})
