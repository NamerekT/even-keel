import { describe, expect, it } from 'vitest'
import { backlog, done, setup, task, type SetupOptions } from './dispatcher.fixture.js'
import { emptyChainState } from './model.js'
import { loadChainState, saveChainState } from './store.js'
import { memoryDatabase } from '../storage/memory.js'
import type { HandoffSession } from './relay.js'
import { handoffPrompt } from './relay.js'
import { readSnapshots, saveSnapshot, snapshotReason } from './snapshots.js'

const session = (changes: Partial<HandoffSession> = {}): HandoffSession => ({
  sessionId: 'old-session', agentId: 'old-sess', account: 'global', cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', transcript: null,
  lastReplyAt: '2026-09-26T11:50:00.000Z', recent: [],
  lastMessage: 'Work is committed; continue once ABC-2 is done.', checkpoint: null, ...changes,
})

async function released(reason: 'postpone' | 'skip', options: SetupOptions = {}) {
  const state = { ...emptyChainState(), active: [{ project: 'ABC', current: {
    task: 'ABC-1', sessionId: 'old-session', since: '2026-09-26T11:00:00.000Z',
  }, paused: false, error: null }] }
  const context = setup({ state, live: { 'ABC-1': 'old-session' }, ...options })
  context.handoffs['ABC-1'] = session()
  context.dispatcher.setTasks('ABC', [task('ABC-1')])
  await context.dispatcher.idle()
  if (reason === 'skip') context.dispatcher.skip('ABC', 'ABC-1')
  else context.dispatcher.setTasks('ABC', [task('ABC-1', undefined, 'ABC-2'), task('ABC-2', backlog)])
  await context.dispatcher.idle()
  return context
}

async function back(context: Awaited<ReturnType<typeof released>>, reason: 'postpone' | 'skip') {
  context.clock.now = new Date('2026-09-26T14:00:00.000Z')
  context.dispatcher.setTasks('ABC', [task('ABC-1'), task('ABC-2', done)])
  if (reason === 'skip') context.dispatcher.unskip('ABC', 'ABC-1')
  context.dispatcher.start('ABC')
  await context.dispatcher.idle()
}

describe.each(['postpone', 'skip'] as const)('a task returned after %s', (reason) => {
  const cause = reason === 'postpone' ? 'unblocked' : 'unskipped'

  it('hands an idle session over with the release reason and the work already done', async () => {
    const context = await released(reason)
    await back(context, reason)
    expect(context.relays).toMatchObject([{ kind: 'relay', sessionId: 'old-session', reason: cause }])
    const prompt = context.relays[0]!.prompt!
    expect(prompt).toContain('Work is committed')
    expect(prompt).not.toContain('скорее всего, с вопросом')
    expect(prompt).toContain(reason === 'postpone' ? 'ABC-2' : 'Пропустить')
    expect(context.journal.at(-1)).toMatchObject({ reason: 'relay', cause, previous: 'old-session' })
    expect(context.dispatcher.state.active[0]?.current?.sessionId).toBe('session-1')
    expect(context.dispatcher.state.shelved).toEqual({})
  })

  it('adopts a session that is mid-turn when the task returns', async () => {
    const context = await released(reason)
    context.busy.add('ABC-1')
    await back(context, reason)
    expect(context.relays).toEqual([])
    expect(context.dispatcher.state.active[0]?.current?.sessionId).toBe('old-session')
  })

  it('adopts a session with a question of its own at return', async () => {
    const asked: Record<string, string> = {}
    const context = await released(reason, { asked })
    asked['ABC-1'] = 'ask-1'
    await back(context, reason)
    expect(context.relays).toEqual([])
    expect(context.dispatcher.state.active[0]?.current?.sessionId).toBe('old-session')
  })

  it('does not replace a session released while waiting on its own question', async () => {
    const asked = { 'ABC-1': 'ask-1' }
    const context = await released(reason, { asked })
    delete (asked as Record<string, string>)['ABC-1']
    await back(context, reason)
    expect(context.relays).toEqual([])
    expect(context.dispatcher.state.shelved).toEqual({})
  })

  it.each(['prompt', 'answer'] as const)('adopts a session with a later %s', async (kind) => {
    const context = await released(reason)
    context.handoffs['ABC-1'] = session({ recent: [{ at: '2026-09-26T13:00:00.000Z', kind, text: 'Continue here.' }] })
    await back(context, reason)
    expect(context.relays).toEqual([])
    expect(context.dispatcher.state.active[0]?.current?.sessionId).toBe('old-session')
  })

  it('makes the same handover after saving and reading the state database', async () => {
    const before = await released(reason)
    const db = await memoryDatabase()
    try {
      await saveChainState(db, before.dispatcher.state)
      const context = setup({ state: await loadChainState(db), live: { 'ABC-1': 'old-session' } })
      context.handoffs['ABC-1'] = session()
      await back(context, reason)
      expect(context.relays).toMatchObject([{ reason: cause, sessionId: 'old-session' }])
      expect(context.journal.at(-1)).toMatchObject({ reason: 'relay', cause })
      const prompt = context.relays[0]!.prompt!
      const snapshot = { at: context.clock.now.toISOString(), task: 'ABC-1', sessionId: 'session-1',
        previous: 'old-session', reason: snapshotReason(cause), prompt, notePath: null, note: null }
      await saveSnapshot(db, snapshot)
      expect(await readSnapshots(db)).toEqual([snapshot])
      expect(snapshot.reason).toBe(cause)
    } finally {
      await db.close()
    }
  }, 30_000)

  it('recovers the reason and blocker context when a restart interrupts the handover', async () => {
    const before = await released(reason)
    const state = structuredClone(before.dispatcher.state)
    state.active = [{ project: 'ABC', current: { task: 'ABC-1', sessionId: 'old-session',
      since: '2026-09-26T14:00:00.000Z', starting: '2026-09-26T14:00:00.000Z', move: cause,
      ...(reason === 'postpone' && { reply: 'Closed blockers: ABC-2.' }),
    }, paused: false, error: null }]
    state.released = {}
    state.shelved = {}
    const db = await memoryDatabase()
    try {
      await saveChainState(db, state)
      const context = setup({ state: await loadChainState(db), live: { 'ABC-1': 'old-session' } })
      context.handoffs['ABC-1'] = session()
      context.dispatcher.setTasks('ABC', [task('ABC-1')])
      await context.dispatcher.idle()
      expect(context.relays).toMatchObject([{ reason: cause, sessionId: 'old-session' }])
      if (reason === 'postpone') expect(context.relays[0]!.prompt).toContain('Closed blockers: ABC-2.')
      expect(context.journal.at(-1)).toMatchObject({ reason: 'relay', cause })
    } finally {
      await db.close()
    }
  }, 30_000)

  it.each(['en', 'ru'] as const)('describes the return in %s without claiming a Backlog question', (language) => {
    const prompt = handoffPrompt('ABC-1', session(), cause, language)
    expect(prompt).toContain(language === 'en' ? (reason === 'skip' ? 'Skip' : 'blocker') : (reason === 'skip' ? 'Пропустить' : 'блокер'))
    expect(prompt).not.toContain('most likely with a question')
    expect(prompt).not.toContain('скорее всего, с вопросом')
  })
})

it('runs the blocker in the same chain, cleans it up at Done and hands the postponed task over', async () => {
  const context = await released('postpone')
  context.dispatcher.setTasks('ABC', [task('ABC-1', undefined, 'ABC-2'), task('ABC-2')])
  context.dispatcher.start('ABC')
  await context.dispatcher.idle()
  expect(context.launched).toEqual(['ABC/ABC-2'])
  context.dispatcher.setTasks('ABC', [task('ABC-1', undefined, 'ABC-2'), task('ABC-2', done)])
  await context.dispatcher.idle()
  expect(context.finished).toContain('ABC/ABC-2')
  expect(context.relays).toMatchObject([{ reason: 'unblocked', sessionId: 'old-session' }])
  expect(context.dispatcher.state.active[0]?.current?.sessionId).toBe('session-2')
})
