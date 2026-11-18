import { describe, expect, it } from 'vitest'
import type { CurrentTask } from '../../src/chain/dispatcher.js'
import type { TaskSession } from '../../src/chain/launches.js'
import { notice } from '../../src/notice/notice.js'
import { chatHandover } from './sessionStart.js'

describe('chatHandover', () => {
  const current = (patch: Partial<CurrentTask> = {}): CurrentTask => ({ task: 'ABC-1', sessionId: 'new', since: '2026-01-01T08:00:00.000Z', ...patch })
  const run = (patch: Partial<TaskSession> = {}): TaskSession => ({ sessionId: 'new', at: '2026-01-01T10:00:00.000Z', how: 'restart', cause: 'message', resumed: 0, answers: 0, ...patch })
  const handing = current({ sessionId: 'old', starting: '2026-01-01T10:00:00.000Z', move: 'message', reply: 'The user\'s message:\n\nCheck the logs too.' })

  it('is a handover from the press with the message the service is handing over', () => {
    expect(chatHandover(handing, { phase: 'handover', since: '2026-01-01T10:00:00.000Z' }, [], null)).toEqual({
      phase: 'handover',
      since: '2026-01-01T10:00:00.000Z',
      message: 'Check the logs too.',
      sessionId: null,
    })
  })

  it('goes on while the new session boots and works on its first answer, with the message the service kept', () => {
    const booting = current({ message: 'Check the logs too.' })
    for (const phase of ['boot', 'answer'] as const) {
      expect(chatHandover(booting, { phase, since: '2026-01-01T10:00:00.000Z' }, [run()], null)).toEqual({
        phase,
        since: '2026-01-01T10:00:00.000Z',
        message: 'Check the logs too.',
        sessionId: 'new',
      })
    }
    expect(chatHandover(current(), { phase: 'boot', since: '2026-01-01T10:00:00.000Z' }, [run()], null)?.message).toBeNull()
  })

  it('goes on by the kept message while the new session\'s run has not reached the page', () => {
    expect(chatHandover(current({ message: 'Hi' }), { phase: 'boot', since: '2026-01-01T10:00:20.000Z' }, [], null)).toMatchObject({ since: '2026-01-01T10:00:20.000Z', sessionId: 'new' })
    expect(chatHandover(current(), { phase: 'boot', since: '2026-01-01T10:00:20.000Z' }, [], null)).toBeNull()
  })

  it('carries the error of a handover that paused the chain', () => {
    const error = notice('chain.launching', { task: 'ABC-1' })
    expect(chatHandover(handing, { phase: 'handover', since: '2026-01-01T10:00:00.000Z' }, [], error)).toMatchObject({ phase: 'handover', error })
  })

  it('is nothing for a start of another kind or once the session is up', () => {
    const restarting = current({ sessionId: 'old', starting: '2026-01-01T10:00:00.000Z', move: 'restart' })
    expect(chatHandover(restarting, { phase: 'handover', since: '2026-01-01T10:00:00.000Z' }, [], null)).toBeNull()
    expect(chatHandover(current(), { phase: 'boot', since: '2026-01-01T10:00:00.000Z' }, [run({ cause: undefined, how: 'checkpoint' })], null)).toBeNull()
    expect(chatHandover(current({ message: 'Check the logs too.' }), null, [run()], null)).toBeNull()
  })
})
