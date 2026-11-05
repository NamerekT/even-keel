import { describe, expect, it } from 'vitest'
import type { Changes } from '../git/types.js'
import type { SetupOptions } from './dispatcher.fixture.js'
import { afterDone, failedRun } from './maincheck.fixture.js'
import type { UnchangedDeps } from './model.js'
import { PROMPTS } from './prompts.js'
import type { HandoffSession } from './relay.js'

const red = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] } as const
const REASON = 'the runner was never acquired; the failed jobs are rerun'

const marked = (sessionId: string, lastReplyAt = '2026-09-26T12:10:00.000Z'): HandoffSession => ({
  sessionId,
  agentId: `agent-${sessionId}`,
  account: 'global',
  cwd: '/repo/.claude/worktrees/abc-fix',
  workdir: '/repo/.claude/worktrees/abc-fix',
  branch: 'abc-fix/task',
  transcript: null,
  lastReplyAt,
  recent: [],
  lastMessage: `Nothing to fix.\n\nNO CHANGES: ${REASON}`,
  checkpoint: null,
  noChanges: REASON,
})

/** A red main fixed by a session without a task, whose turn ended with `NO CHANGES:` on a branch that holds `changes`. */
async function markedFix(changes: Changes = { ahead: 0, files: 0 }, options: SetupOptions = {}) {
  const completed: string[] = []
  const unchanged: UnchangedDeps = {
    changes: async () => changes,
    complete: async (_project, task) => {
      completed.push(task)
    },
  }
  const harness = await afterDone(null, (ci) => {
    ci.fixTask = false
  }, { ...options, unchanged })
  const { dispatcher, handoffs, ci } = harness
  ci.verdict = red
  dispatcher.check()
  await dispatcher.idle()
  const sessionId = dispatcher.state.active[0]!.current!.sessionId!
  handoffs['ABC-FIX'] = marked(sessionId)
  return { ...harness, sessionId, completed }
}

type Steps = { check(): void; idle(): Promise<void> }

const step = async (dispatcher: Steps) => {
  dispatcher.check()
  await dispatcher.idle()
}

/** A step on a green verdict and one more: `fakeMain` moves main on the cleanup's sync, so that push is judged too. */
const greenSteps = async (dispatcher: Steps) => {
  await step(dispatcher)
  await step(dispatcher)
}

describe('Dispatcher and a fix session that finds nothing to fix (EKR-88)', () => {
  it('closes the fix once the red commit is green again, cleans up and goes on with the chain', async () => {
    const { dispatcher, ci, journal, clock, finished, launched, completed, sessionId, log } = await markedFix()
    ci.verdict = { state: 'green' }
    await step(dispatcher)
    expect(journal.filter((entry) => entry.task === 'ABC-FIX').at(-1)).toEqual({
      at: clock.now.toISOString(),
      project: 'ABC',
      task: 'ABC-FIX',
      sessionId,
      reason: 'unneeded',
      commit: 'bbbbbbbbbb',
    })
    expect(dispatcher.state.ci.ABC?.fix).toBeUndefined()
    expect(dispatcher.state.ci.ABC?.green).toBe('bbbbbbbbbb')
    expect(finished).toContain('ABC/ABC-FIX')
    expect(completed).toEqual([])
    expect(log).toContain('ci: ABC: bbbbbbb is green after all, the fix session found nothing to fix')
    await step(dispatcher)
    expect(launched).toContain('ABC/ABC-2')
  })

  it('keeps waiting for the user while the red commit stays red, and goes on once a rerun turns it green', async () => {
    const { dispatcher, ci, finished, launched, log } = await markedFix()
    await step(dispatcher)
    await step(dispatcher)
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-FIX')
    expect(dispatcher.state.ci.ABC?.fix?.task).toBe('ABC-FIX')
    expect(finished).not.toContain('ABC/ABC-FIX')
    expect(launched).not.toContain('ABC/ABC-2')
    expect(log.filter((line) => line.includes('found nothing to fix, and bbbbbbb is still red; it waits for the user'))).toHaveLength(1)
    // The runs of the red commit are over: the CI is asked again on each step, or a rerun would go unseen.
    expect(ci.looks.length).toBeGreaterThanOrEqual(2)

    ci.verdict = { state: 'green' }
    await greenSteps(dispatcher)
    expect(launched).toContain('ABC/ABC-2')
  })

  it('waits for the verdict while the rerun is under way', async () => {
    const { dispatcher, ci, launched } = await markedFix()
    ci.verdict = { state: 'pending' }
    await step(dispatcher)
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-FIX')
    expect(launched).not.toContain('ABC/ABC-2')
  })

  it('tells a fix session whose branch has commits beyond main, as a task would be told, and closes nothing', async () => {
    const { dispatcher, ci, relays, sessionId, launched } = await markedFix({ ahead: 1, files: 0 })
    ci.verdict = { state: 'green' }
    await step(dispatcher)
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-FIX', sessionId, prompt: PROMPTS.ru.unchanged.ahead('main') }])
    expect(dispatcher.state.ci.ABC?.fix?.task).toBe('ABC-FIX')
    expect(launched).not.toContain('ABC/ABC-2')
  })

  it('reads the mark of a fix session in PR mode too: the fix merges by itself there', async () => {
    const { dispatcher, ci, launched } = await markedFix(undefined, { pullRequests: true })
    ci.verdict = { state: 'green' }
    await greenSteps(dispatcher)
    expect(launched).toContain('ABC/ABC-2')
  })
})
