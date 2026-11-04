import { expect, it } from 'vitest'
import { PROMPTS } from '../chain/prompts.js'
import { commitAndMerge, ends } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

it('adds session instructions on launch and relay, but not to a chat reply after a service restart', { timeout: 60_000 }, async () => {
  const run = new Harness()
  const instructions = 'Model-specific instructions.'
  run.config.modelPrompts = { 'Claude | *': instructions }
  run.board.add('ABC-1')
  run.agent.script('ABC-1', ends({ ask: 'Keep the old format?' }), ends({ say: 'Ready for the next step.' }), commitAndMerge())
  const launches = () => run.agent.calls.filter((call) => call.kind === 'launch')
  const resumes = () => run.agent.calls.filter((call) => call.kind === 'resume')
  try {
    await run.start()
    await run.post('chain/unattended', { on: true })
    await run.startChain(PROJECT_ID)
    await run.until(() => run.service.sessions.some((view) => view.ask !== null), 'the question seen')
    expect(launches()[0]!.prompt).toContain(instructions)
    expect(launches()[0]!.prompt).toContain(PROMPTS.en.unattended)

    await run.restart()
    await run.until(() => run.service.sessions.some((view) => view.ask !== null), 'the question restored')
    const session = run.agent.sessionsOf('ABC-1')[0]!
    await run.post('session/answer', { project: PROJECT_ID, task: 'ABC-1', sessionId: session.sessionId, ask: session.ask!.id, answers: {}, text: 'готово' })
    await run.until(() => resumes().length === 1 && run.agent.sessionsOf('ABC-1')[0]?.status === 'idle' && run.service.agentStatus('ABC-1') !== 'busy', 'the resumed turn finished')
    expect(resumes()[0]!.prompt).toContain('готово')
    expect(resumes()[0]!.prompt).not.toContain(instructions)
    expect(resumes()[0]!.prompt).not.toContain(PROMPTS.en.unattended)

    await run.post('chain/restart', { project: PROJECT_ID, task: 'ABC-1' })
    await run.until(() => run.board.status('ABC-1') === 'Done', 'the new session merged')
    expect(launches()).toHaveLength(2)
    expect(launches()[1]!.prompt).toContain(instructions)
    expect(launches()[1]!.prompt).toContain(PROMPTS.en.unattended)
  } finally {
    await run.stop()
  }
})
