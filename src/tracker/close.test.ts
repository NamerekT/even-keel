import { describe, expect, it } from 'vitest'
import { noticeOf } from '../notice/notice.js'
import { closeInto, PendingCloses } from './close.js'

async function refusal(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return noticeOf(error)
  }
  throw new Error('expected a refusal')
}

describe('closeInto', () => {
  it('closes into the chosen done status, or the tracker first one when none is chosen', async () => {
    const calls: (string | undefined)[] = []
    const complete = async (status?: string) => calls.push(status) > 0
    expect(await closeInto('ABC-1', { status: 'Released', level: 'source', fits: true }, complete)).toBe(true)
    expect(await closeInto('ABC-1', undefined, complete)).toBe(true)
    expect(calls).toEqual(['Released', undefined])
  })

  it('does not try a status the rules do not take for done', async () => {
    const calls: (string | undefined)[] = []
    const why = await refusal(closeInto('ABC-1', { status: 'In Review', level: 'profile', fits: false }, async (status) => calls.push(status) > 0))
    expect(why).toEqual({ code: 'statusMove.notDone', params: { task: 'ABC-1', status: 'In Review', level: 'profile' } })
    expect(calls).toEqual([])
  })

  it('names the status and the level of a refused close, with the tracker answer as the detail', async () => {
    const errors: unknown[] = []
    const refused = closeInto('ABC-1', { status: 'Released', level: 'source', fits: true }, async () => { throw new Error('tracker: archived') }, {
      onRefused: (error) => errors.push(error),
    })
    expect(await refusal(refused)).toEqual({
      code: 'tracker.completeRefused',
      params: { task: 'ABC-1', status: 'Released', level: 'source' },
      detail: 'tracker: archived',
    })
    expect(errors).toHaveLength(1)
  })

  it('marks the refusals of a close that waits on the user', async () => {
    const fits = await refusal(closeInto('ABC-1', { status: 'In Review', level: 'source', fits: false }, async () => true, { held: true }))
    expect(fits.params).toEqual({ task: 'ABC-1', status: 'In Review', level: 'source', held: true })
    const tracker = await refusal(closeInto('ABC-1', undefined, async () => { throw new Error('no') }, { held: true }))
    expect(tracker).toEqual({ code: 'tracker.completeRefused', params: { task: 'ABC-1', held: true }, detail: 'no' })
  })
})

describe('PendingCloses', () => {
  it('keeps a refusal by reader and task until it is cleared', () => {
    const pending = new PendingCloses()
    const why = { code: 'statusMove.notDone', params: { task: 'ABC-1', status: 'In Review', level: 'source' } } as const
    pending.note('ABC', 'ABC-1', why)
    expect(pending.has('ABC', 'ABC-1')).toBe(true)
    expect(pending.has('XYZ', 'ABC-1')).toBe(false)
    expect(pending.failures('ABC')).toEqual([why])
    pending.keep('ABC', ['ABC-2'])
    expect(pending.has('ABC', 'ABC-1')).toBe(false)
    pending.note('ABC', 'ABC-1', why)
    pending.clear('ABC', 'ABC-1')
    expect(pending.failures('ABC')).toEqual([])
  })
})
