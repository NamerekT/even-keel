import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '../agent/contract.js'
import { TranscriptFold } from '../sessions/transcript.js'
import { commitAndMerge, Gate } from './agent.fixture.js'
import { Harness, PROJECT_ID } from './service.fixture.js'

describe('a finished session context window', { timeout: 60_000 }, () => {
  let run: Harness
  afterEach(async () => {
    await run.stop()
    vi.restoreAllMocks()
  })

  it('serves the window observed during the turn after Done without probing for the card', async () => {
    run = new Harness()
    run.project.autoCompactWindow = 250_000
    const gate = new Gate()
    run.board.add('ABC-1')
    run.agent.script('ABC-1', async (turn) => {
      turn.show({ text: 'Working', context: 212_000 })
      await turn.park(gate)
      return commitAndMerge()(turn)
    })
    const sessions = run.agent.sessions.bind(run.agent)
    vi.spyOn(run.agent, 'sessions').mockImplementation(async (home) =>
      (await sessions(home)).map((entry) => ({ ...entry, model: 'opus' })))
    const probe = vi.fn(async () => 250_000)
    Object.assign(run.agent, { contextWindow: probe })
    const summary = new TranscriptFold().summary()
    vi.spyOn(run.agent as Agent, 'record').mockImplementation(async (_home, sessionId) => ({
      sessionId, startedAt: null, lastActivityAt: null, contextTokens: 212_000, contextWindow: null,
      tokens: summary.tokens, stage: null, feed: [], workdir: null, branch: null, apiError: null, account: null,
    }))
    await run.start()
    await run.startChain(PROJECT_ID)
    await run.until(() => run.service.sessions.some((view) => view.contextWindow === 250_000), 'the session window observed')
    const sessionId = run.agent.sessionsOf('ABC-1')[0]!.sessionId
    gate.open()
    await run.until(() => run.board.status('ABC-1') === 'Done', 'the task done')
    await run.until(() => run.agent.isGone(sessionId), 'the session finished')
    const probes = probe.mock.calls.length
    const { host, port } = run.service.listen
    const response = await fetch(`http://${host}:${port}/api/sessions/${sessionId}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ contextTokens: 212_000, contextWindow: 250_000 })
    expect(probe).toHaveBeenCalledTimes(probes)
  })
})
