import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commitAndMerge, ends, Gate, type Turn } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('chat mail end to end', { timeout: 60_000 }, () => {
  let run: Harness

  beforeEach(() => {
    run = new Harness()
  })

  afterEach(async () => {
    await run.stop()
  })

  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const resumes = () => run.agent.calls.filter((call) => call.kind === 'resume')
  const chat = (sessionId: string, text: string) => run.post('session/answer', { project: PROJECT_ID, task: 'ABC-1', sessionId, ask: null, answers: {}, text })
  const mailOf = (sessionId: string) => run.service.mailbox.of(sessionId)
  /** Waits for the service's read of the sessions to show the task's session, as the page does before its chat sends. */
  const seen = (what: string, asking = false) =>
    run.until(() => run.service.sessions.some((view) => view.task === 'ABC-1' && view.lamp !== 'finished' && (!asking || view.ask !== null)), what)

  /** A turn whose hook asks for mail once, as on its first tool call, then works until `gate` opens and goes on as `then`. */
  const listening = (gate: Gate, then: Turn, got: (string | null)[] = []): Turn => async (turn) => {
    got.push(await turn.mail('PreToolUse'))
    await turn.park(gate)
    return then(turn)
  }

  it('hands a message to a working session through its mailbox hook once, and one left at the end of the turn by a resume', async () => {
    run.board.add('ABC-1')
    const first = new Gate()
    const second = new Gate()
    const got: (string | null)[] = []
    run.agent.script(
      'ABC-1',
      listening(first, async (turn) => {
        got.push(await turn.mail('PostToolUse'), await turn.mail('PostToolUse'))
        await turn.park(second)
        return { say: 'Kept the old format.' }
      }, got),
      commitAndMerge(),
    )
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => got.length === 1, 'the hook of ABC-1 asked for mail')
    await seen('the session of ABC-1 seen')
    const session = launches()[0]!

    await chat(session.sessionId, 'Keep the old format.')
    expect(mailOf(session.sessionId)).toEqual([expect.objectContaining({ fate: 'waiting' })])
    first.open()
    await run.until(() => got.length === 3, 'the hook asked again')
    expect(got).toEqual([null, expect.stringContaining('Keep the old format.'), null])
    expect(mailOf(session.sessionId)).toEqual([expect.objectContaining({ fate: 'delivered', event: 'PostToolUse' })])

    await chat(session.sessionId, 'And merge it.')
    second.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(resumes()).toEqual([expect.objectContaining({ sessionId: session.sessionId, prompt: expect.stringContaining('And merge it.') })])
    expect(resumes()[0]!.prompt).not.toContain('Keep the old format.')
    expect(mailOf(session.sessionId).map((mail) => [mail.fate, mail.event])).toEqual([['delivered', 'PostToolUse'], ['delivered', 'resume']])
    expect(launches()).toHaveLength(1)
  })

  it('gives a message back to the chat when the session merged before its hook took it, and refuses one after the merge', async () => {
    run.board.add('ABC-1')
    const posted = new Gate()
    const checked = new Gate()
    const got: (string | null)[] = []
    run.agent.script(
      'ABC-1',
      listening(posted, async (turn) => {
        await commitAndMerge()(turn)
        got.push(await turn.mail('PostToolUse'))
        await turn.park(checked)
        return { say: 'ABC-1 merged' }
      }, got),
    )
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => got.length === 1, 'the hook of ABC-1 asked for mail')
    await seen('the session of ABC-1 seen')
    const session = launches()[0]!

    await chat(session.sessionId, 'Also rename the button.')
    posted.open()
    await run.until(() => got.length === 2, 'the hook asked after the merge')
    expect(got).toEqual([null, null])
    expect(mailOf(session.sessionId)).toEqual([expect.objectContaining({ fate: 'returned', reason: 'closed' })])
    await expect(chat(session.sessionId, 'And the label.')).rejects.toThrow(/closed/)

    checked.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    await run.until(() => !existsSync(session.cwd), 'the worktree of ABC-1 removed')
    expect(resumes()).toEqual([])
    expect(existsSync(join(run.repo, '.temp', 'inbox'))).toBe(false)
    expect(run.git('status', '--porcelain')).toBe('')
  })

  it('keeps the chain going when the answer is refused, does not replay it, and an explicit retry reaches the same session', async () => {
    run.board.add('ABC-1')
    run.agent.script('ABC-1', ends({ ask: 'Keep the old format?' }), commitAndMerge())
    await run.start()
    await run.startChain(PROJECT_ID)
    await seen('the question seen', true)
    const session = run.agent.sessionsOf('ABC-1')[0]!
    const answer = () => run.post('session/answer', { project: PROJECT_ID, task: 'ABC-1', sessionId: session.sessionId, ask: session.ask!.id, answers: { 'Keep the old format?': 'Yes' }, text: '' })

    run.agent.refuse = 1
    await answer()
    await run.until(() => run.log.some((line) => line.includes('did not reach the session')), 'the refusal logged')
    await run.pass(60_000)
    const chain = run.service.dispatcher.state.active[0]!
    expect(chain).toMatchObject({ paused: false, error: null })
    expect(chain.current).toMatchObject({ task: 'ABC-1', sessionId: session.sessionId })
    expect(chain.current).not.toHaveProperty('answering')
    expect(resumes()).toEqual([])

    await answer()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'ABC-1 done')
    expect(resumes()).toEqual([expect.objectContaining({ sessionId: session.sessionId, prompt: expect.stringContaining('Yes') })])
    expect(launches()).toHaveLength(1)
  })

  it('delivers a message left in the mailbox to the same session once the chain stops after its turn', async () => {
    run.board.add('ABC-1')
    const gate = new Gate()
    const got: (string | null)[] = []
    run.agent.script('ABC-1', listening(gate, ends({ say: 'Half of it is done.' }), got), ends({ say: 'Answered.' }))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => got.length === 1, 'the hook of ABC-1 asked for mail')
    await seen('the session of ABC-1 seen')
    const session = launches()[0]!

    await chat(session.sessionId, 'What is left?')
    await run.post('chain/stopAfter', { project: PROJECT_ID, on: true })
    gate.open()
    await run.until(() => resumes().length === 1, 'the message resumed the session')
    expect(run.service.dispatcher.state.active).toEqual([])
    expect(resumes()[0]).toMatchObject({ sessionId: session.sessionId, prompt: expect.stringContaining('What is left?') })
    expect(mailOf(session.sessionId)).toEqual([expect.objectContaining({ fate: 'delivered', event: 'resume' })])
    expect(launches()).toHaveLength(1)
  })
})
