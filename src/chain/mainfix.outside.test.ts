import { describe, expect, it } from 'vitest'
import { afterDone, failedRun } from './maincheck.fixture.js'
import type { UnchangedDeps } from './model.js'
import type { HandoffSession } from './relay.js'

const red = { state: 'red', failed: [{ kind: 'forgejo', run: failedRun }] } as const
const RED = 'bbbbbbbbbb'
const GREEN = 'eeeeeeeeee'

const sessionOf = (task: string, sessionId: string, noChanges?: string): HandoffSession => ({
  sessionId,
  agentId: `agent-${sessionId}`,
  account: 'global',
  cwd: `/repo/.claude/worktrees/${task.toLowerCase()}`,
  workdir: `/repo/.claude/worktrees/${task.toLowerCase()}`,
  branch: `${task.toLowerCase()}/task`,
  transcript: null,
  lastReplyAt: '2026-09-26T12:00:00.000Z',
  recent: [],
  lastMessage: noChanges === undefined ? 'Main looks fixed already: what now?' : `NO CHANGES: ${noChanges}`,
  checkpoint: null,
  ...(noChanges !== undefined && { noChanges }),
})

type Steps = { check(): void; idle(): Promise<void> }

const step = async (dispatcher: Steps) => {
  dispatcher.check()
  await dispatcher.idle()
}

/** ABC-2 was mid-turn when main went red at `RED`; it is stopped, and a session without a task fixes main. */
async function fixing() {
  const unchanged: UnchangedDeps = { changes: async () => ({ ahead: 0, files: 0 }), complete: async () => {} }
  const harness = await afterDone(
    0,
    (ci) => {
      ci.fixTask = false
      ci.remote.ABC = RED
    },
    { unchanged },
  )
  const { dispatcher, busy, handoffs, ci } = harness
  busy.add('ABC-2')
  handoffs['ABC-2'] = sessionOf('ABC-2', 'session-2')
  ci.verdict = red
  await step(dispatcher)
  expect(dispatcher.state.active[0]).toMatchObject({ current: { task: 'ABC-FIX' }, interrupted: { task: 'ABC-2', commit: RED } })
  busy.delete('ABC-2')
  ci.verdicts[RED] = red
  ci.verdict = { state: 'green' }
  const fixSession = dispatcher.state.active[0]!.current!.sessionId!
  return { ...harness, fixSession }
}

/** `GREEN`, a child of the red commit, is pushed by hand and its CI is green. */
function fixedOutside(ci: Awaited<ReturnType<typeof fixing>>['ci'], past = true) {
  ci.remote.ABC = GREEN
  ci.verdicts[GREEN] = { state: 'green' }
  if (past) ci.behind[GREEN] = [RED]
}

describe('A fix of main once main is fixed outside the chain (BTN-1328)', () => {
  it('closes a fix that found nothing to fix and goes on with the stopped task from the green commit', async () => {
    const { dispatcher, ci, handoffs, journal, finished, relays, log, fixSession } = await fixing()
    handoffs['ABC-FIX'] = sessionOf('ABC-FIX', fixSession, 'main is already fixed')
    await step(dispatcher)
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-FIX')
    expect(log).toContain('chain: ABC: the fix session ABC-FIX found nothing to fix, and bbbbbbb is still red; it waits for the user')

    fixedOutside(ci)
    await step(dispatcher)
    expect(journal.filter((entry) => entry.task === 'ABC-FIX').at(-1)).toMatchObject({ reason: 'unneeded', commit: GREEN })
    expect(dispatcher.state.ci.ABC?.fix).toBeUndefined()
    expect(dispatcher.state.ci.ABC?.green).toBe(GREEN)
    expect(finished).toContain('ABC/ABC-FIX')
    expect(log).toContain('ci: ABC: main is green at eeeeeee past bbbbbbb; the fix session ABC-FIX is no longer needed')
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-2', sessionId: 'session-2' }])
    expect(relays[0]!.prompt).toContain('bbbbbbb')
    expect(relays[0]!.prompt).toContain('eeeeeee')
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-2')
  })

  it('lets go of a fix session that waits for an answer, without touching it, and goes on with the stopped task', async () => {
    const { dispatcher, ci, handoffs, waiting, journal, finished, stopped, relays, fixSession } = await fixing()
    handoffs['ABC-FIX'] = sessionOf('ABC-FIX', fixSession)
    waiting.add('ABC-FIX')
    await step(dispatcher)
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-FIX')

    fixedOutside(ci)
    await step(dispatcher)
    expect(journal.filter((entry) => entry.task === 'ABC-FIX').at(-1)).toMatchObject({ reason: 'unneeded', commit: GREEN })
    expect(dispatcher.state.ci.ABC?.fix).toBeUndefined()
    expect(dispatcher.state.ci.ABC?.skippedSessions).toEqual({ 'ABC-FIX': [fixSession] })
    expect(finished).not.toContain('ABC/ABC-FIX')
    expect(stopped).toEqual(['session-2'])
    expect(relays).toMatchObject([{ kind: 'reply', task: 'ABC-2', sessionId: 'session-2' }])
    expect(relays[0]!.prompt).toContain('eeeeeee')
  })

  it('leaves a fix session mid-turn at its work', async () => {
    const { dispatcher, ci, busy, journal, relays } = await fixing()
    busy.add('ABC-FIX')
    fixedOutside(ci)
    await step(dispatcher)
    await step(dispatcher)
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-FIX')
    expect(dispatcher.state.ci.ABC?.fix?.task).toBe('ABC-FIX')
    expect(journal.some((entry) => entry.task === 'ABC-FIX' && entry.reason === 'unneeded')).toBe(false)
    expect(relays).toEqual([])
  })

  it('keeps waiting while the green commit is not past the red one', async () => {
    const { dispatcher, ci, handoffs, relays, fixSession } = await fixing()
    handoffs['ABC-FIX'] = sessionOf('ABC-FIX', fixSession, 'main is already fixed')
    fixedOutside(ci, false)
    await step(dispatcher)
    await step(dispatcher)
    expect(dispatcher.state.ci.ABC?.green).toBe(GREEN)
    expect(dispatcher.state.active[0]?.current?.task).toBe('ABC-FIX')
    expect(dispatcher.state.ci.ABC?.fix?.task).toBe('ABC-FIX')
    expect(relays).toEqual([])
  })
})
